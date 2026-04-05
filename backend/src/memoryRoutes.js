import { Router } from "express";
import {
  addAssertion,
  addMediaEvent,
  getMetrics,
  getNarrative,
  getScheduleByDay,
  listMedia,
} from "./memoryStore.js";

const router = Router();

router.get("/schedule", async (req, res) => {
  try {
    const daysBack = Math.min(60, Math.max(1, Number(req.query.days) || 14));
    const schedule = await getScheduleByDay({ daysBack });
    res.json({ schedule });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

router.get("/media", async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const seriesKey = req.query.seriesKey ? String(req.query.seriesKey) : undefined;
    const media = await listMedia({ seriesKey, limit });
    res.json({ media });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

router.post("/media", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.url || typeof body.url !== "string") {
      res.status(400).json({ error: "url is required" });
      return;
    }
    const event = await addMediaEvent({
      url: body.url,
      title: body.title,
      description: body.description,
      seriesKey: body.seriesKey,
      episodeNumber: body.episodeNumber != null ? Number(body.episodeNumber) : null,
      occurredAt: body.occurredAt,
    });
    const narrative = await getNarrative();
    res.json({ event, narrative });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

router.post("/assertions", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.rawText || typeof body.rawText !== "string") {
      res.status(400).json({ error: "rawText is required" });
      return;
    }
    const result = await addAssertion({
      rawText: body.rawText,
      seriesKey: body.seriesKey,
      autoReconcile: body.autoReconcile !== false,
    });
    const narrative = await getNarrative();
    res.json({ ...result, narrative });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

router.get("/narrative", async (_req, res) => {
  try {
    const narrative = await getNarrative();
    res.json({ narrative });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

router.get("/metrics", async (req, res) => {
  try {
    const weeks = Math.min(52, Math.max(1, Number(req.query.weeks) || 8));
    const metrics = await getMetrics({ weeks });
    res.json(metrics);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

export default router;
