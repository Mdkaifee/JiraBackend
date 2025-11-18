const express = require('express');
const Project = require('../models/Project');
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
 *       500:
 *         description: Server error
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const projects = await Project.find({ owner: req.user.userId }).sort({ createdAt: -1 });
    return sendResponse(res, 200, 'Projects fetched', { projects });
  } catch (err) {
    return handleRouteError(res, 'List projects error', err);
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
    const project = await Project.findOne({ _id: projectId, owner: req.user.userId });

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
      { _id: projectId, owner: req.user.userId },
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
