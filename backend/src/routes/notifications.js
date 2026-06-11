const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { getNotifications, markRead, markAllRead, deleteNotification, clearNotifications } = require('../controllers/notificationController');

router.use(authenticate);
router.get   ('/',          getNotifications);
router.put   ('/read-all',  markAllRead);
router.delete('/clear-all', clearNotifications);
router.put   ('/:id/read',  markRead);
router.delete('/:id',       deleteNotification);

module.exports = router;
