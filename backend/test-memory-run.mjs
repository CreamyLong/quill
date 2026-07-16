import { Client } from "@langchain/langgraph-sdk";

const client = new Client({ apiUrl: "http://127.0.0.1:8123" });

async function main() {
  const thread = await client.threads.create();
  console.log("thread:", thread.thread_id);
  const run = client.runs.stream(thread.thread_id, "deaflow", {
    input: {
      messages: [
        { type: "human", content: "My name is Bob and I am a medicinal chemist working on DHODH inhibitors." }
      ]
    }
  });
  for await (const chunk of run) {
    if (chunk.event === "messages/complete" || chunk.event === "error") {
      console.log("event:", chunk.event);
    }
  }
  console.log("run complete, waiting for memory debounce (30s)...");
  await new Promise(r => setTimeout(r, 35000));
  const res = await fetch("http://127.0.0.1:8123/memory/status");
  const data = await res.json();
  console.log("facts:", JSON.stringify(data.data.facts, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
