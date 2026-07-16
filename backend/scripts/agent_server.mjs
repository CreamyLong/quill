/**
 * Minimal HTTP server for the JS Quill agent runtime.
 *
 * Usage:
 *   cd backend && npm run build && OPENAI_API_KEY=... npm run agent:server
 *
 * Endpoint:
 *   POST /threads/{thread_id}/runs
 *   Body: { "question": "What is React?" }
 *
 * The response is streamed as newline-delimited JSON events compatible with
 * LangGraph's "messages" stream mode.  This is a demonstration bridge; a
 * production setup should use LangGraph Platform or a fully-spec'd gateway.
 */

import http from "node:http";
import { URL } from "node:url";

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { getAppConfig } from "../dist/packages/harness/quill/config/app_config.js";
import { buildChatModel, pickModelConfig } from "./model_factory.mjs";

const appConfig = getAppConfig();
const modelConfig = pickModelConfig(appConfig);

const PORT = Number(process.env.QUILL_PORT ?? 8123);
const API_KEY = modelConfig.api_key ?? process.env.OPENAI_API_KEY;

const checkpointer = new MemorySaver();
const graph = createQuillAgent({
  model: buildChatModel(modelConfig),
  systemPrompt:
    "You are Quill, a helpful research assistant. Answer questions concisely and accurately.",
  planMode: false,
  checkpointer,
});

console.log(`Using model: ${modelConfig.name} (${modelConfig.model})`);

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    jsonResponse(res, 200, { status: "ok" });
    return;
  }

  const match = url.pathname.match(/^\/threads\/([^/]+)\/runs$/);
  if (!match || req.method !== "POST") {
    jsonResponse(res, 404, { detail: "Not found" });
    return;
  }

  if (!API_KEY) {
    jsonResponse(res, 503, { detail: "OPENAI_API_KEY is not configured" });
    return;
  }

  const threadId = decodeURIComponent(match[1]);
  let body;
  try {
    body = await collectBody(req);
  } catch {
    jsonResponse(res, 400, { detail: "Invalid JSON body" });
    return;
  }

  const question = body.question ?? body.input?.messages?.[0]?.content;
  if (!question || typeof question !== "string") {
    jsonResponse(res, 400, { detail: "Missing 'question' field" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    const stream = await graph.stream(
      { messages: [new HumanMessage(question)] },
      {
        configurable: { thread_id: threadId },
        streamMode: "messages",
      }
    );
    for await (const event of stream) {
      const [message, metadata] = event;
      const payload = {
        event: "message",
        data: {
          type: message.getType(),
          content: message.content,
          id: message.id,
          ...metadata,
        },
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ event: "end" })}\n\n`);
    res.end();
  } catch (error) {
    const payload = {
      event: "error",
      data: { detail: error instanceof Error ? error.message : String(error) },
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Quill TS agent server listening on http://localhost:${PORT}`);
  console.log(`Health:  curl http://localhost:${PORT}/health`);
  console.log(`Run:     curl -X POST http://localhost:${PORT}/threads/cli/run \\\n  -H 'Content-Type: application/json' \\\n  -d '{"question":"What is React?"}'`);
});
