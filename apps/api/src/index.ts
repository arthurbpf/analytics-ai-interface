import express from "express";

const app = express();

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.listen(3001, "127.0.0.1");
