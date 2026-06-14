import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { addBeneficiary, listBeneficiaries, activateLegacy } from '../services/inheritance.js';

const r = Router();
r.use(requireAuth);
r.get('/', wrap(async (req, res) => res.json(await listBeneficiaries(req.user.sub))));
r.post('/', wrap(async (req, res) => {
  const { beneficiary_name, relationship, share_percentage } = req.body;
  if (!beneficiary_name || !relationship || share_percentage == null)
    return res.status(400).json({ error: 'missing_fields' });
  res.status(201).json(await addBeneficiary({
    ownerId: req.user.sub, name: beneficiary_name, relationship, sharePercentage: share_percentage,
  }));
}));
// Activate the 70-year legacy window.
r.post('/activate', wrap(async (req, res) => res.json(await activateLegacy(req.user.sub))));
export default r;
