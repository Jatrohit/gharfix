'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');
const { mapService } = require('../utils/mappers');
const { slugify } = require('../utils/helpers');
const serviceModel = require('../models/serviceModel');

exports.list = asyncHandler(async (req, res) => {
  const rows = await serviceModel.findAll();
  return success(res, rows.map(mapService), 'Services fetched');
});

/** Admin view: includes inactive services. */
exports.listAll = asyncHandler(async (req, res) => {
  const rows = await serviceModel.findAll({ includeInactive: true });
  return success(res, rows.map(mapService), 'Services fetched');
});

/** GET /api/services/:idOrSlug - numeric -> id, otherwise slug. */
exports.getOne = asyncHandler(async (req, res) => {
  const param = req.params.idOrSlug;
  const service = /^\d+$/.test(param) ? await serviceModel.findById(Number(param)) : await serviceModel.findBySlug(param.toLowerCase());
  if (!service || !service.is_active) throw new AppError('Service not found', 404);
  return success(res, mapService(service), 'Service fetched');
});

exports.create = asyncHandler(async (req, res) => {
  const b = req.body;
  const id = await serviceModel.create({ ...b, slug: slugify(b.slug || b.name) });
  return created(res, mapService(await serviceModel.findById(id)), 'Service created successfully');
});

exports.update = asyncHandler(async (req, res) => {
  const existing = await serviceModel.findById(req.params.id);
  if (!existing) throw new AppError('Service not found', 404);
  const data = { ...req.body };
  if (data.slug) data.slug = slugify(data.slug);
  if (data.is_active !== undefined) data.is_active = data.is_active ? 1 : 0;
  await serviceModel.update(existing.id, data);
  return success(res, mapService(await serviceModel.findById(existing.id)), 'Service updated successfully');
});

/** Hard-deletes unused services; services with professionals/bookings are deactivated instead. */
exports.remove = asyncHandler(async (req, res) => {
  const existing = await serviceModel.findById(req.params.id);
  if (!existing) throw new AppError('Service not found', 404);
  if (await serviceModel.isInUse(existing.id)) {
    await serviceModel.update(existing.id, { is_active: 0 });
    return success(res, { id: existing.id, deactivated: true }, 'Service is in use, so it was deactivated instead of deleted');
  }
  await serviceModel.remove(existing.id);
  return success(res, { id: existing.id, deactivated: false }, 'Service deleted successfully');
});
