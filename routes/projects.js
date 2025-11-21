const express = require('express');
const mongoose = require('mongoose');
const Project = require('../Models/Project');
const User = require('../Models/User');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

const DEFAULT_BOARD_COLUMNS = [
  { name: 'To Do', defaultCard: true },
  { name: 'In Progress' },
  { name: 'In Review' },
  { name: 'Done' }
];

function sendResponse(res, statusCode, message, extra = {}) {
  const success = statusCode >= 200 && statusCode < 400;
  return res.status(statusCode).json({ success, message, ...extra });
}

function handleRouteError(res, label, err) {
  console.error(`${label}:`, err);
  return sendResponse(res, 500, 'Something went wrong. Please try again.');
}

function createDefaultCards(columnConfig = {}) {
  if (!columnConfig.defaultCard)
    return [];

  const columnName = columnConfig.name || 'To Do';

  return [
    {
      title: 'Task 1',
      description: 'Scrum 1 default work item',
      status: columnName,
      assignee: null,
      dueDate: new Date()
    }
  ];
}

function normalizeColumns(columns = [], options = {}) {
  const { enforceDefaultCard = true } = options;

  if (!columns.length) {
    return DEFAULT_BOARD_COLUMNS.map((column, index) => ({
      name: column.name,
      order: index + 1,
      cards: createDefaultCards(column)
    }));
  }

  return columns.map((col, index) => {
    const fallbackColumn = DEFAULT_BOARD_COLUMNS[index] || {};
    const columnName = col.name || fallbackColumn.name || `Column ${index + 1}`;

    const preparedCards = Array.isArray(col.cards)
      ? col.cards.map((card) => ({
          title: card.title || 'Scrum 1',
          description: card.description || '',
          status: card.status || columnName,
          assignee: card.assignee || null,
          dueDate: card.dueDate ? new Date(card.dueDate) : new Date()
        }))
      : [];

    const cards = preparedCards.length
      ? preparedCards
      : enforceDefaultCard
        ? createDefaultCards({
            ...fallbackColumn,
            ...col,
            name: columnName
          })
        : [];

    return {
      name: columnName,
      order: typeof col.order === 'number' ? col.order : index + 1,
      cards
    };
  });
}

function normalizeExistingColumns(columns = [], options = {}) {
  const { fallbackToDefault = false, ...rest } = options;

  if (!Array.isArray(columns) || !columns.length) {
    return fallbackToDefault
      ? normalizeColumns([], rest)
      : [];
  }

  return normalizeColumns(columns, rest);
}

function normalizeColumnName(name = '') {
  return (name || '').trim();
}

function findColumnIndex(columns = [], searchName = '') {
  const normalizedSearch = normalizeColumnName(searchName).toLowerCase();
  if (!normalizedSearch)
    return -1;

  return columns.findIndex((column) =>
    normalizeColumnName(column.name).toLowerCase() === normalizedSearch
  );
}

function sortColumnsByOrder(columns = []) {
  return [...columns].sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;

    if (orderA === orderB)
      return normalizeColumnName(a.name).localeCompare(normalizeColumnName(b.name));

    return orderA - orderB;
  });
}

function reindexColumns(columns = []) {
  return columns.map((column, idx) => ({
    ...column,
    order: idx + 1
  }));
}

function sanitizeColumns(columns = [], options = {}) {
  const preparedColumns = normalizeExistingColumns(columns, options);
  if (!preparedColumns.length)
    return [];

  return reindexColumns(sortColumnsByOrder(preparedColumns));
}

function columnNameExists(columns = [], name, ignoreIndex = -1) {
  const normalized = normalizeColumnName(name).toLowerCase();
  if (!normalized)
    return false;

  return columns.some((column, idx) =>
    idx !== ignoreIndex &&
    normalizeColumnName(column.name).toLowerCase() === normalized
  );
}

function buildProjectAccessQuery(projectId, userId) {
  return {
    _id: projectId,
    $or: [
      { owner: userId },
      { 'members.user': userId }
    ]
  };
}

function isProjectMember(project, userId) {
  if (!project || !userId)
    return false;

  const targetId = String(userId);
  if (project.owner && String(project.owner) === targetId)
    return true;

  return Array.isArray(project.members) &&
    project.members.some((member) => member.user && String(member.user) === targetId);
}

function isProjectOwner(project, userId) {
  if (!project || !userId)
    return false;

  return project.owner && String(project.owner) === String(userId);
}

function normalizeEmail(email = '') {
  if (typeof email !== 'string')
    return '';

  return email.trim().toLowerCase();
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function formatInvalidEntry(entry) {
  if (entry === undefined || entry === null)
    return '[empty]';

  if (typeof entry === 'string')
    return entry || '[empty]';

  if (typeof entry === 'number' || typeof entry === 'boolean')
    return String(entry);

  if (typeof entry === 'object') {
    if (typeof entry.email === 'string')
      return entry.email || '[empty]';

    try {
      const serialized = JSON.stringify(entry);
      return serialized.length ? serialized : '[invalid]';
    } catch (err) {
      return '[invalid]';
    }
  }

  return String(entry);
}

function collectEmailsFromPayload(primaryEmail, emailList) {
  const requested = [];
  const invalidRawEntries = [];

  const processValue = (value) => {
    if (value === undefined || value === null)
      return;

    if (typeof value === 'string') {
      requested.push(value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(processValue);
      return;
    }

    if (typeof value === 'object') {
      if (typeof value.email === 'string') {
        requested.push(value.email);
        return;
      }

      invalidRawEntries.push(value);
      return;
    }

    invalidRawEntries.push(value);
  };

  processValue(emailList);
  processValue(primaryEmail);

  const normalizedEntries = requested.map((raw) => ({
    raw,
    normalized: normalizeEmail(raw)
  }));

  const invalidEmails = [
    ...invalidRawEntries.map((entry) => formatInvalidEntry(entry)),
    ...normalizedEntries
      .filter((entry) => !entry.normalized)
      .map((entry) => entry.raw || '[empty]')
  ];

  const normalizedEmails = [
    ...new Set(
      normalizedEntries
        .map((entry) => entry.normalized)
        .filter(Boolean)
    )
  ];

  return { normalizedEmails, invalidEmails };
}

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: Manage Jira-like spaces/projects
 */

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Create a Jira space/project with default board columns
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [created, in-progress, completed]
 *               boardType:
 *                 type: string
 *                 enum: [scrum, kanban]
 *               currentSprint:
 *                 type: string
 *               columns:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/BoardColumn'
 *     responses:
 *       201:
 *         description: Project created successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     project:
 *                       $ref: '#/components/schemas/Project'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, status, boardType, currentSprint, columns } = req.body;

    if (!name)
      return sendResponse(res, 400, 'Project name is required');

    const project = await Project.create({
      owner: req.user.userId,
      members: [{
        user: req.user.userId,
        role: 'owner',
        addedBy: req.user.userId,
        joinedAt: new Date()
      }],
      name,
      description,
      status,
      boardType,
      currentSprint,
      columns: normalizeColumns(columns || [], { enforceDefaultCard: true })
    });

    return sendResponse(res, 201, 'Project created successfully', { project });

  } catch (err) {
    return handleRouteError(res, 'Create project error', err);
  }
});

/**
 * @swagger
 * /projects:
 *   get:
 *     summary: List spaces/projects for the authenticated user
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of projects
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     projects:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Project'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [
        { owner: req.user.userId },
        { 'members.user': req.user.userId }
      ]
    }).sort({ createdAt: -1 });

    return sendResponse(res, 200, 'Projects fetched', { projects });
  } catch (err) {
    return handleRouteError(res, 'List projects error', err);
  }
});

/**
 * @swagger
 * /projects/invitations:
 *   get:
 *     summary: List pending invitations for the authenticated user
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invitations fetched
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     invites:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ProjectInviteSummary'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/invitations', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId, { email: 1, fullName: 1 });
    if (!user || !user.email)
      return sendResponse(res, 404, 'User profile not found');

    const email = normalizeEmail(user.email);

    const projects = await Project.find({
      invites: { $elemMatch: { email, status: 'pending' } }
    })
      .select({ name: 1, description: 1, invites: 1 })
      .populate('invites.invitedBy', 'email fullName');

    const invites = [];

    projects.forEach((project) => {
      (project.invites || [])
        .filter((invite) => invite.email === email && invite.status === 'pending')
        .forEach((invite) => {
          invites.push({
            inviteId: invite._id,
            projectId: project._id,
            projectName: project.name,
            invitedBy: invite.invitedBy,
            invitedAt: invite.invitedAt
          });
        });
    });

    return sendResponse(res, 200, 'Pending invitations fetched', { invites });
  } catch (err) {
    return handleRouteError(res, 'List invitations error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/invite:
 *   post:
 *     summary: Invite one or more users by email or add existing users to the project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             anyOf:
 *               - required: [email]
 *               - required: [emails]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Single email to invite
 *               emails:
 *                 type: array
 *                 description: Array of email addresses to invite
 *                 items:
 *                   type: string
 *                   format: email
 *     responses:
 *       200:
 *         description: Invitation created or user added
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Project not found
 *       500:
 *         description: Server error
 */
router.post('/:projectId/invite', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { email, emails } = req.body || {};

    const requestedEmails = [];
    if (Array.isArray(emails))
      requestedEmails.push(...emails);
    if (typeof email === 'string' && email)
      requestedEmails.push(email);

    const normalizedEntries = requestedEmails.map((raw) => ({
      raw,
      normalized: normalizeEmail(raw)
    }));
    const invalidEmails = normalizedEntries
      .filter((entry) => !entry.normalized)
      .map((entry) => entry.raw);
    const normalizedEmails = [
      ...new Set(
        normalizedEntries
          .map((entry) => entry.normalized)
          .filter(Boolean)
      )
    ];

    if (!normalizedEmails.length)
      return sendResponse(res, 400, 'At least one valid email is required');

    const project = await Project.findOne(buildProjectAccessQuery(projectId, req.user.userId));
    if (!project)
      return sendResponse(res, 404, 'Project not found');

    if (!isProjectOwner(project, req.user.userId))
      return sendResponse(res, 403, 'Only the project owner can send invitations');

    project.members = Array.isArray(project.members) ? project.members : [];
    project.invites = Array.isArray(project.invites) ? project.invites : [];

    const existingUsers = await User.find({ email: { $in: normalizedEmails } });
    const userByEmail = new Map(
      existingUsers.map((user) => [normalizeEmail(user.email), user])
    );

    const markInviteAccepted = (targetEmail) => {
      project.invites.forEach((invite) => {
        if (invite.email === targetEmail && invite.status === 'pending') {
          invite.status = 'accepted';
          invite.acceptedAt = new Date();
        }
      });
    };

    const membersToAdd = [];
    const invitesToAdd = [];
    const results = {
      addedMembers: [],
      invitationsSent: [],
      alreadyMembers: [],
      alreadyInvited: [],
      invalidEmails
    };

    normalizedEmails.forEach((normalizedEmail) => {
      const existingUser = userByEmail.get(normalizedEmail);

      if (existingUser) {
        const alreadyScheduled =
          membersToAdd.some((member) => String(member.user) === String(existingUser._id)) ||
          isProjectMember(project, existingUser._id);

        if (alreadyScheduled) {
          results.alreadyMembers.push(normalizedEmail);
          return;
        }

        membersToAdd.push({
          user: existingUser._id,
          role: 'collaborator',
          addedBy: req.user.userId,
          joinedAt: new Date()
        });

        markInviteAccepted(normalizedEmail);
        results.addedMembers.push(normalizedEmail);
        return;
      }

      const hasPendingInvite = project.invites.some(
        (invite) => invite.email === normalizedEmail && invite.status === 'pending'
      );

      if (hasPendingInvite) {
        results.alreadyInvited.push(normalizedEmail);
        return;
      }

      invitesToAdd.push({
        email: normalizedEmail,
        invitedBy: req.user.userId,
        status: 'pending',
        invitedAt: new Date()
      });
      results.invitationsSent.push(normalizedEmail);
    });

    if (membersToAdd.length)
      project.members.push(...membersToAdd);
    if (invitesToAdd.length)
      project.invites.push(...invitesToAdd);

    await project.save();

    const message = results.invitationsSent.length || results.addedMembers.length
      ? 'Invitations processed'
      : 'No invitations were processed';

    return sendResponse(res, 200, message, { results });
  } catch (err) {
    return handleRouteError(res, 'Invite collaborator error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/invite:
 *   delete:
 *     summary: Revoke a pending invitation or remove a member by email
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             anyOf:
 *               - required: [email]
 *               - required: [emails]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address to revoke access for
 *               emails:
 *                 type: array
 *                 description: Array of email addresses to revoke access for
 *                 items:
 *                   type: string
 *                   format: email
 *     responses:
 *       200:
 *         description: Invitation revoked or member removed
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Invite/member not found
 *       500:
 *         description: Server error
 */
router.delete('/:projectId/invite', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { email, emails } = req.body || {};

    const requestedEmails = [];
    if (Array.isArray(emails))
      requestedEmails.push(...emails);
    if (typeof email === 'string' && email)
      requestedEmails.push(email);

    const normalizedEntries = requestedEmails.map((raw) => ({
      raw,
      normalized: normalizeEmail(raw)
    }));

    const invalidEmails = normalizedEntries
      .filter((entry) => !entry.normalized)
      .map((entry) => entry.raw);

    const normalizedEmails = [
      ...new Set(
        normalizedEntries
          .map((entry) => entry.normalized)
          .filter(Boolean)
      )
    ];

    if (!normalizedEmails.length)
      return sendResponse(res, 400, 'At least one valid email is required');

    const project = await Project.findOne(buildProjectAccessQuery(projectId, req.user.userId));
    if (!project)
      return sendResponse(res, 404, 'Project not found');

    if (!isProjectOwner(project, req.user.userId))
      return sendResponse(res, 403, 'Only the project owner can revoke invitations');

    project.members = Array.isArray(project.members) ? project.members : [];
    project.invites = Array.isArray(project.invites) ? project.invites : [];

    const existingUsers = await User.find({ email: { $in: normalizedEmails } });
    const userByEmail = new Map(
      existingUsers.map((user) => [normalizeEmail(user.email), user])
    );

    const result = {
      membersRemoved: [],
      invitesCancelled: [],
      notFound: [],
      notRemovable: [],
      invalidEmails
    };

    normalizedEmails.forEach((normalizedEmail) => {
      const existingUser = userByEmail.get(normalizedEmail);

      if (existingUser) {
        const isOwnerTarget = project.owner && String(project.owner) === String(existingUser._id);
        if (isOwnerTarget) {
          result.notRemovable.push(normalizedEmail);
          return;
        }

        const memberIndex = project.members.findIndex(
          (member) => member.user && String(member.user) === String(existingUser._id)
        );

        if (memberIndex > -1) {
          project.members.splice(memberIndex, 1);
          result.membersRemoved.push(normalizedEmail);
          return;
        }
      }

      const invite = project.invites.find(
        (entry) => entry.email === normalizedEmail && entry.status === 'pending'
      );

      if (invite) {
        invite.status = 'cancelled';
        invite.cancelledAt = new Date();
        result.invitesCancelled.push(normalizedEmail);
        return;
      }

      result.notFound.push(normalizedEmail);
    });

    if (!result.membersRemoved.length && !result.invitesCancelled.length)
      return sendResponse(
        res,
        404,
        'No pending invites or project members found for the provided emails',
        { result }
      );

    await project.save();

    return sendResponse(res, 200, 'Access revoked', { result });
  } catch (err) {
    return handleRouteError(res, 'Revoke invite error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/accept-invite:
 *   post:
 *     summary: Accept an invitation to join a project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Invitation accepted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Invitation not found
 *       500:
 *         description: Server error
 */
router.post('/:projectId/accept-invite', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;

    const user = await User.findById(req.user.userId, { email: 1 });
    if (!user || !user.email)
      return sendResponse(res, 404, 'User profile not found');

    const email = normalizeEmail(user.email);

    const project = await Project.findOne({
      _id: projectId,
      invites: { $elemMatch: { email, status: 'pending' } }
    });

    if (!project)
      return sendResponse(res, 404, 'Invitation not found for this project');

    const invite = (project.invites || []).find(
      (entry) => entry.email === email && entry.status === 'pending'
    );

    if (!invite)
      return sendResponse(res, 404, 'Invitation not found');

    if (!isProjectMember(project, user._id)) {
      project.members = Array.isArray(project.members) ? project.members : [];
      project.members.push({
        user: user._id,
        role: 'collaborator',
        addedBy: invite.invitedBy || req.user.userId,
        joinedAt: new Date()
      });
    }

    invite.status = 'accepted';
    invite.acceptedAt = new Date();

    await project.save();

    return sendResponse(res, 200, 'Invitation accepted');
  } catch (err) {
    return handleRouteError(res, 'Accept invitation error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/columns:
 *   get:
 *     summary: Fetch board columns/statuses for a project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: names
 *         schema:
 *           type: string
 *         description: Comma-separated list of column names to check for existence
 *     responses:
 *       200:
 *         description: Columns fetched
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     columns:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/BoardColumn'
 *                     requestedColumns:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           exists:
 *                             type: boolean
 *                           column:
 *                             allOf:
 *                               - $ref: '#/components/schemas/BoardColumn'
 *                               - nullable: true
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project not found
 *       500:
 *         description: Server error
 */
router.get('/:projectId/columns', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { names } = req.query || {};

    const project = await Project.findOne(
      buildProjectAccessQuery(projectId, req.user.userId),
      { columns: 1 }
    ).lean();

    if (!project)
      return sendResponse(res, 404, 'Project not found');

    const columns = sortColumnsByOrder(
      normalizeExistingColumns(project.columns || [], { enforceDefaultCard: false })
    );

    const extra = { columns };

    if (typeof names === 'string' && names.trim()) {
      const requestedNames = Array.from(
        new Set(
          names
            .split(',')
            .map((value) => normalizeColumnName(value))
            .filter(Boolean)
        )
      );

      if (requestedNames.length) {
        extra.requestedColumns = requestedNames.map((targetName) => {
          const column = columns.find(
            (col) => normalizeColumnName(col.name).toLowerCase() === targetName.toLowerCase()
          );

          return {
            name: targetName,
            exists: Boolean(column),
            column: column || null
          };
        });
      }
    }

    return sendResponse(res, 200, 'Board columns fetched', extra);
  } catch (err) {
    return handleRouteError(res, 'List project columns error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/columns:
 *   post:
 *     summary: Create a new board column/status
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               order:
 *                 type: integer
 *                 description: Desired order position (1-based)
 *               cards:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/BoardCard'
 *     responses:
 *       201:
 *         description: Column created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project not found
 *       409:
 *         description: Column already exists
 *       500:
 *         description: Server error
 */
router.post('/:projectId/columns', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, order, cards } = req.body;

    const normalizedName = normalizeColumnName(name);

    if (!normalizedName)
      return sendResponse(res, 400, 'Column name is required');

    if (cards !== undefined && !Array.isArray(cards))
      return sendResponse(res, 400, 'Cards must be an array');

    const project = await Project.findOne(
      buildProjectAccessQuery(projectId, req.user.userId)
    ).lean();

    if (!project)
      return sendResponse(res, 404, 'Project not found');

    let columns = sanitizeColumns(project.columns || [], { enforceDefaultCard: false });

    if (columnNameExists(columns, normalizedName))
      return sendResponse(res, 409, 'Column already exists');

    const [preparedColumn] = normalizeColumns(
      [{ name: normalizedName, order, cards }],
      { enforceDefaultCard: false }
    );

    const parsedOrder = Number(order);
    const hasOrder = Number.isFinite(parsedOrder) && parsedOrder > 0;
    const insertionIndex = hasOrder
      ? Math.min(Math.floor(parsedOrder) - 1, columns.length)
      : columns.length;

    columns.splice(insertionIndex, 0, preparedColumn);

    const updatedColumns = reindexColumns(columns);

    const updatedProject = await Project.findOneAndUpdate(
      buildProjectAccessQuery(projectId, req.user.userId),
      { columns: updatedColumns },
      { new: true }
    );

    return sendResponse(res, 201, 'Column created', {
      column: updatedProject.columns[insertionIndex],
      columns: updatedProject.columns
    });
  } catch (err) {
    return handleRouteError(res, 'Create column error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/columns/{columnName}:
 *   get:
 *     summary: Fetch a single board column/status
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *       - in: path
 *         name: columnName
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Column fetched
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project or column not found
 *       500:
 *         description: Server error
 */
router.get('/:projectId/columns/:columnName', authMiddleware, async (req, res) => {
  try {
    const { projectId, columnName } = req.params;

    const project = await Project.findOne(
      buildProjectAccessQuery(projectId, req.user.userId),
      { columns: 1 }
    ).lean();

    if (!project)
      return sendResponse(res, 404, 'Project not found');

    const columns = normalizeExistingColumns(project.columns || [], { enforceDefaultCard: false });
    const columnIndex = findColumnIndex(columns, columnName);

    if (columnIndex === -1)
      return sendResponse(res, 404, 'Column not found', { exists: false });

    return sendResponse(res, 200, 'Column fetched', { column: columns[columnIndex] });
  } catch (err) {
    return handleRouteError(res, 'Get column error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/columns/{columnName}:
 *   put:
 *     summary: Update an existing board column/status
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *       - in: path
 *         name: columnName
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               order:
 *                 type: integer
 *               cards:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/BoardCard'
 *     responses:
 *       200:
 *         description: Column updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project or column not found
 *       409:
 *         description: Duplicate column name
 *       500:
 *         description: Server error
 */
router.put('/:projectId/columns/:columnName', authMiddleware, async (req, res) => {
  try {
    const { projectId, columnName } = req.params;
    const { name, order, cards } = req.body;

    const hasUpdates =
      typeof name === 'string' ||
      (order !== undefined && order !== null) ||
      Array.isArray(cards);

    if (!hasUpdates)
      return sendResponse(res, 400, 'Provide at least one field to update');

    if (cards !== undefined && cards !== null && !Array.isArray(cards))
      return sendResponse(res, 400, 'Cards must be an array');

    const project = await Project.findOne(
      buildProjectAccessQuery(projectId, req.user.userId)
    ).lean();

    if (!project)
      return sendResponse(res, 404, 'Project not found');

    let columns = sanitizeColumns(project.columns || [], { enforceDefaultCard: false });
    const columnIndex = findColumnIndex(columns, columnName);

    if (columnIndex === -1)
      return sendResponse(res, 404, 'Column not found');

    const column = columns[columnIndex];

    if (typeof name === 'string') {
      const newName = normalizeColumnName(name);
      if (!newName)
        return sendResponse(res, 400, 'Column name cannot be empty');

      if (columnNameExists(columns, newName, columnIndex))
        return sendResponse(res, 409, 'Column with this name already exists');

      column.name = newName;
      column.cards = column.cards.map((card) => ({
        ...card,
        status: newName
      }));
    }

    if (Array.isArray(cards)) {
      const [normalizedColumn] = normalizeColumns(
        [{ ...column, cards }],
        { enforceDefaultCard: false }
      );
      column.cards = normalizedColumn.cards;
    }

    if (order !== undefined && order !== null) {
      const parsedOrder = Number(order);

      if (!Number.isFinite(parsedOrder))
        return sendResponse(res, 400, 'Order must be a number');

      const nextColumns = columns.slice();
      const [movedColumn] = nextColumns.splice(columnIndex, 1);
      const targetIndex = Math.min(
        Math.max(Math.floor(parsedOrder) - 1, 0),
        nextColumns.length
      );
      nextColumns.splice(targetIndex, 0, movedColumn);
      columns = nextColumns;
    }

    const updatedColumns = reindexColumns(columns);

    const updatedProject = await Project.findOneAndUpdate(
      buildProjectAccessQuery(projectId, req.user.userId),
      { columns: updatedColumns },
      { new: true }
    );

    return sendResponse(res, 200, 'Column updated', { columns: updatedProject.columns });
  } catch (err) {
    return handleRouteError(res, 'Update column error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}/columns/{columnName}:
 *   delete:
 *     summary: Delete a board column/status
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *       - in: path
 *         name: columnName
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetColumn:
 *                 type: string
 *                 description: Column to move cards into before deletion
 *     responses:
 *       200:
 *         description: Column deleted
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project or column not found
 *       500:
 *         description: Server error
 */
router.delete('/:projectId/columns/:columnName', authMiddleware, async (req, res) => {
  try {
    const { projectId, columnName } = req.params;
    const { targetColumn } = req.body || {};

    const project = await Project.findOne(
      buildProjectAccessQuery(projectId, req.user.userId)
    ).lean();

    if (!project)
      return sendResponse(res, 404, 'Project not found');

    let columns = sanitizeColumns(project.columns || [], { enforceDefaultCard: false });
    const columnIndex = findColumnIndex(columns, columnName);

    if (columnIndex === -1)
      return sendResponse(res, 404, 'Column not found');

    const [removedColumn] = columns.splice(columnIndex, 1);

    const hasCards = Array.isArray(removedColumn.cards) && removedColumn.cards.length;

    if (hasCards) {
      const normalizedTarget = normalizeColumnName(targetColumn);

      if (!normalizedTarget)
        return sendResponse(
          res,
          400,
          'Column contains cards. Provide targetColumn or empty it before deletion'
        );

      const targetIndex = findColumnIndex(columns, normalizedTarget);

      if (targetIndex === -1)
        return sendResponse(res, 400, 'Target column not found');

      const destinationName = columns[targetIndex].name;
      const migratedCards = removedColumn.cards.map((card) => ({
        ...card,
        status: destinationName
      }));

      columns[targetIndex].cards = [...columns[targetIndex].cards, ...migratedCards];
    }

    const updatedColumns = reindexColumns(columns);

    const updatedProject = await Project.findOneAndUpdate(
      buildProjectAccessQuery(projectId, req.user.userId),
      { columns: updatedColumns },
      { new: true }
    );

    return sendResponse(res, 200, 'Column deleted', {
      removedColumn: removedColumn.name,
      columns: updatedProject.columns
    });
  } catch (err) {
    return handleRouteError(res, 'Delete column error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}:
 *   get:
 *     summary: Fetch a single project/space by id
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Project found
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     project:
 *                       $ref: '#/components/schemas/Project'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project not found
 *       500:
 *         description: Server error
 */
router.get('/:projectId', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(
      buildProjectAccessQuery(projectId, req.user.userId)
    );

    if (!project)
      return sendResponse(res, 404, 'Project not found');

    return sendResponse(res, 200, 'Project fetched', { project });
  } catch (err) {
    return handleRouteError(res, 'Get project error', err);
  }
});

/**
 * @swagger
 * /projects/{projectId}:
 *   put:
 *     summary: Update project metadata or board columns
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [created, in-progress, completed]
 *               boardType:
 *                 type: string
 *                 enum: [scrum, kanban]
 *               currentSprint:
 *                 type: string
 *               columns:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/BoardColumn'
 *     responses:
 *       200:
 *         description: Project updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     project:
 *                       $ref: '#/components/schemas/Project'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project not found
 *       500:
 *         description: Server error
 */
router.put('/:projectId', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { columns, ...rest } = req.body;

    const updates = { ...rest };
    if (columns)
      updates.columns = normalizeColumns(columns, { enforceDefaultCard: false });

    const project = await Project.findOneAndUpdate(
      buildProjectAccessQuery(projectId, req.user.userId),
      updates,
      { new: true }
    );

    if (!project)
      return sendResponse(res, 404, 'Project not found');

    return sendResponse(res, 200, 'Project updated', { project });

  } catch (err) {
    return handleRouteError(res, 'Update project error', err);
  }
});

module.exports = router;
