const router = require('express').Router({ mergeParams: true });
const { authenticate } = require('../middleware/auth');
const { listItems, addItem, toggleItem, deleteItem } = require('../controllers/shoppingController');

router.use(authenticate);
router.get   ('/',              listItems);
router.post  ('/',              addItem);
router.patch ('/:itemId/toggle',toggleItem);
router.delete('/:itemId',       deleteItem);

module.exports = router;
