import { Router } from "express";
import {
  buildRecentReality,
  checkContinuity,
  checkContinuityLocal,
} from "./continuityGuardian.js";

const router = Router();

router.get("/reality", async (_req, res) => {
  try {
    const days = Math.min(60, Math.max(1, Number(_req.query.days) || 14));
    const recentReality = await buildRecentReality({ windowDays: days });
    res.json({ recentReality });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

router.post("/check", async (req, res) => {
  try {
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message : "";
    const pageUrl =
      body.pageUrl != null && String(body.pageUrl).trim() ? String(body.pageUrl).trim() : null;
    const result = await checkContinuity({ message, pageUrl });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

/** Local rules only (used by Fetch.ai companion service / testing). */
router.post("/check-local", async (req, res) => {
  try {
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message : "";
    const pageUrl =
      body.pageUrl != null && String(body.pageUrl).trim() ? String(body.pageUrl).trim() : null;
    let recentReality = body.recentReality;
    if (!recentReality || typeof recentReality !== "object") {
      recentReality = await buildRecentReality();
    }
    const result = checkContinuityLocal({ message, pageUrl, recentReality });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

export default router;
