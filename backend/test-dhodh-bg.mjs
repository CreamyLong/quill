import { Client } from "@langchain/langgraph-sdk";

const client = new Client({ apiUrl: "http://127.0.0.1:8123" });

const question = `As an antiviral drug discovery project, design 10+ novel DHODH inhibitors based on de novo pyrimidine synthesis. Requirements:
1) Analyze how RNA vs DNA viruses rely on host pyrimidine synthesis;
2) Compare DHODH inhibitors vs DAA drugs for resistance barrier and broad-spectrum advantage;
3) Provide 12 candidate molecular structures with clear target binding modes, synthesizability, and SMILES, and explain clinical development value for each.`;

async function main() {
  const thread = await client.threads.create();
  console.log("THREAD_ID=" + thread.thread_id);
  const start = Date.now();
  const run = client.runs.stream(thread.thread_id, "deaflow", {
    input: { messages: [{ type: "human", content: question }] },
    config: {
      configurable: { subagent_enabled: true, is_plan_mode: true },
      recursion_limit: 150,
    },
  });
  let lastEvent = "";
  for await (const chunk of run) {
    lastEvent = chunk.event;
    if (chunk.event === "error") {
      console.log("ERROR chunk:", JSON.stringify(chunk, null, 2));
    }
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("RUN_DONE elapsed=" + elapsed + "s lastEvent=" + lastEvent);
  const stateRes = await fetch(`http://127.0.0.1:8123/threads/${thread.thread_id}/states`);
  const state = await stateRes.json();
  const messages = state[0]?.values?.messages ?? [];
  const lastMsg = messages[messages.length - 1];
  console.log("LAST_MSG_TYPE=" + (lastMsg?.type ?? "none"));
  console.log("LAST_MSG_LEN=" + (lastMsg?.content?.length ?? 0));
}

main().catch(err => { console.error("FATAL", err); process.exit(1); });
