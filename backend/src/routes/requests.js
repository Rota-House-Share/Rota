const router = require('express').Router();
const { authenticate: auth } = require('../middleware/auth');
const ctrl   = require('../controllers/requestController');
const { handleRequestPhotos } = require('../controllers/uploadController');

router.get('/',              auth, ctrl.getRequests);
router.post('/',             auth, handleRequestPhotos, ctrl.createRequest);
router.patch('/:id/status',  auth, ctrl.adminStatusGuard, ctrl.updateStatus);
router.delete('/:id',        auth, ctrl.deleteRequest);
router.get('/:id/comments',  auth, ctrl.getComments);
router.post('/:id/comments', auth, ctrl.addComment);

module.exports = router;
