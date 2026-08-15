const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CHECKPOINT_PATH = path.join(DATA_DIR, "checkpoint.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadCheckpoint() {
  return loadJson(CHECKPOINT_PATH, { lastIndexedBlock: null });
}

function saveCheckpoint(checkpoint) {
  saveJson(CHECKPOINT_PATH, checkpoint);
}

function loadEvents() {
  return loadJson(EVENTS_PATH, []);
}

function saveEvents(events) {
  saveJson(EVENTS_PATH, events);
}

module.exports = {
  DATA_DIR,
  CHECKPOINT_PATH,
  EVENTS_PATH,
  loadCheckpoint,
  saveCheckpoint,
  loadEvents,
  saveEvents,
};
