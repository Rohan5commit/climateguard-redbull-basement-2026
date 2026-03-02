import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const ENV_PATH = resolve(".env.local");
const OUTPUT_PATH = resolve("data/nim-benchmark-results.json");
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const REQUEST_TIMEOUT_MS = 15000;
const REQUIRED_MODEL_COUNT = 10;

const MODEL_PRIORITY_PATTERNS = [
  /meta\/llama-3\.1-405b-instruct/i,
  /meta\/llama-3\.3-70b-instruct/i,
  /nvidia\/llama-3\.1-nemotron-70b-instruct/i,
  /qwen\/qwen2\.5-72b-instruct/i,
  /deepseek-ai\/deepseek-r1/i,
  /mistralai\/mistral-large/i,
  /mistralai\/mixtral-8x22b-instruct/i,
  /meta\/llama-3\.1-70b-instruct/i,
  /qwen\/qwen2\.5-coder-32b-instruct/i,
  /google\/gemma-2-27b-it/i,
  /meta\/llama-3\.1-8b-instruct/i,
  /mistralai\/mixtral-8x7b-instruct/i,
  /qwen\/qwen2\.5-14b-instruct/i,
  /qwen\/qwen2\.5-7b-instruct/i,
  /microsoft\/phi-3\.5-mini-instruct/i,
];

const PROMPTS = [
  {
    id: "json_instruction_following",
    description: "Strict JSON schema compliance",
    temperature: 0,
    maxTokens: 180,
    messages: [
      {
        role: "system",
        content:
          "You are a precise assistant that follows output constraints exactly.",
      },
      {
        role: "user",
        content: `Return ONLY one minified JSON object with exactly these keys:
location, hazards, risk_score, confidence, actions

Constraints:
- location: "Austin, TX"
- hazards: ["flood","heat","wildfire"] in this exact order
- risk_score: 67
- confidence: 0.84
- actions: exactly 2 short imperative strings

No markdown and no extra text.`,
      },
    ],
    evaluate: evaluateJsonInstructionPrompt,
  },
  {
    id: "concise_risk_advisory_quality",
    description: "Concise risk advisory writing quality",
    temperature: 0.2,
    maxTokens: 220,
    messages: [
      {
        role: "system",
        content: "You write concise, practical homeowner advisories.",
      },
      {
        role: "user",
        content: `Write a basement-apartment risk advisory for Houston, TX.
Requirements:
- 70 to 90 words total
- Exactly 3 bullet points, each line starting with "- "
- Must include the phrases "flood insurance", "sump pump", and "evacuation route"
- Calm, practical tone
- No disclaimer text`,
      },
    ],
    evaluate: evaluateRiskAdvisoryPrompt,
  },
  {
    id: "simple_reasoning_consistency",
    description: "Simple arithmetic reasoning consistency",
    temperature: 0,
    maxTokens: 160,
    messages: [
      {
        role: "system",
        content:
          "You are a careful reasoner. Follow requested output formats exactly.",
      },
      {
        role: "user",
        content: `A basement water sensor reports levels in cm at hourly intervals: [2, 4, 6, 8].
Assume the increase stays linear.
1) Predict the level after 2 more hours.
2) Threshold alert triggers at 11 cm. Will it trigger within 2 hours?
Return ONLY JSON in this format:
{"after_two_hours": number, "threshold_triggered": boolean, "explanation": "max 20 words"}`,
      },
    ],
    evaluate: evaluateReasoningPrompt,
  },
];

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadDotEnv(filePath) {
  const envText = await readFile(filePath, "utf8");
  const entries = {};

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    entries[key] = value;
  }

  return entries;
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function normalizeMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((chunk) => {
      if (typeof chunk === "string") {
        return chunk;
      }
      if (chunk && typeof chunk === "object" && typeof chunk.text === "string") {
        return chunk.text;
      }
      return "";
    })
    .join("")
    .trim();
}

async function postChatCompletion({ baseUrl, apiKey, model, prompt }) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const body = {
    model,
    messages: prompt.messages,
    max_tokens: prompt.maxTokens,
    temperature: prompt.temperature,
  };
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const startedAt = performance.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const elapsedMs = roundTo(performance.now() - startedAt, 2);

    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(responseText);
    } catch {
      parsedPayload = null;
    }

    if (!response.ok) {
      const errorMessage =
        parsedPayload?.error?.message ??
        parsedPayload?.error ??
        responseText.slice(0, 240);
      return {
        success: false,
        latencyMs: elapsedMs,
        status: response.status,
        error: `HTTP ${response.status}: ${errorMessage}`,
        outputText: "",
      };
    }

    const outputText = normalizeMessageContent(
      parsedPayload?.choices?.[0]?.message?.content,
    );

    if (!outputText) {
      return {
        success: false,
        latencyMs: elapsedMs,
        status: response.status,
        error: "Empty model output",
        outputText: "",
      };
    }

    return {
      success: true,
      latencyMs: elapsedMs,
      status: response.status,
      error: null,
      outputText,
    };
  } catch (error) {
    const elapsedMs = roundTo(performance.now() - startedAt, 2);
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `Request timed out after ${REQUEST_TIMEOUT_MS} ms`
          : error.message
        : "Unknown request failure";

    return {
      success: false,
      latencyMs: elapsedMs,
      status: null,
      error: message,
      outputText: "",
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchModelIds({ baseUrl, apiKey }) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/models`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    const details =
      payload?.error?.message ?? payload?.error ?? `HTTP ${response.status}`;
    throw new Error(`Failed to fetch models: ${details}`);
  }

  if (!Array.isArray(payload?.data)) {
    throw new Error("Unexpected /models response shape");
  }

  return payload.data
    .map((model) => model?.id)
    .filter((id) => typeof id === "string")
    .sort((a, b) => a.localeCompare(b));
}

function parseApproxParamsInBillions(modelId) {
  const lower = modelId.toLowerCase();

  const mixMatch = lower.match(/(\d+)x(\d+)b/);
  if (mixMatch) {
    const first = Number(mixMatch[1]);
    const second = Number(mixMatch[2]);
    if (!Number.isNaN(first) && !Number.isNaN(second)) {
      return first * second;
    }
  }

  const singleMatch = lower.match(/(\d+(?:\.\d+)?)b/);
  if (singleMatch) {
    const parsed = Number(singleMatch[1]);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function isLikelyChatModel(modelId) {
  const lower = modelId.toLowerCase();
  const excludedTokens = [
    "embedding",
    "embed",
    "rerank",
    "rank",
    "retriever",
    "guardrail",
    "moderation",
    "nmt",
    "whisper",
    "asr",
    "tts",
    "sdxl",
    "stable-diffusion",
    "cosmos",
    "video",
    "vision",
    "vlm",
    "multimodal",
    "clip",
  ];

  if (excludedTokens.some((token) => lower.includes(token))) {
    return false;
  }

  const positiveTokens = [
    "instruct",
    "chat",
    "assistant",
    "it",
    "r1",
    "reason",
    "nemotron",
    "llama",
    "qwen",
    "mistral",
    "mixtral",
    "deepseek",
    "gemma",
    "phi",
  ];

  return positiveTokens.some((token) => lower.includes(token));
}

function computeModelStrengthScore(modelId) {
  const lower = modelId.toLowerCase();
  let score = parseApproxParamsInBillions(modelId);

  if (lower.includes("llama-3.3")) score += 70;
  if (lower.includes("llama-3.1")) score += 60;
  if (lower.includes("nemotron")) score += 65;
  if (lower.includes("qwen2.5")) score += 58;
  if (lower.includes("mistral-large")) score += 62;
  if (lower.includes("mixtral")) score += 56;
  if (lower.includes("deepseek-r1")) score += 68;
  if (lower.includes("gemma-2-27b")) score += 45;
  if (lower.includes("phi-3.5")) score += 34;
  if (lower.includes("instruct")) score += 20;
  if (lower.includes("chat")) score += 10;

  return score;
}

function unique(values) {
  return [...new Set(values)];
}

function selectTopModels(modelIds) {
  const uniqueIds = unique(modelIds);
  const likelyChatIds = uniqueIds.filter(isLikelyChatModel);
  const selected = [];

  for (const pattern of MODEL_PRIORITY_PATTERNS) {
    const match = likelyChatIds.find(
      (modelId) => pattern.test(modelId) && !selected.includes(modelId),
    );
    if (match) {
      selected.push(match);
    }
    if (selected.length === REQUIRED_MODEL_COUNT) {
      return selected;
    }
  }

  const rankedFallback = likelyChatIds
    .filter((modelId) => !selected.includes(modelId))
    .map((modelId) => ({
      modelId,
      score: computeModelStrengthScore(modelId),
    }))
    .sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId))
    .map((entry) => entry.modelId);

  for (const modelId of rankedFallback) {
    selected.push(modelId);
    if (selected.length === REQUIRED_MODEL_COUNT) {
      break;
    }
  }

  if (selected.length < REQUIRED_MODEL_COUNT) {
    throw new Error(
      `Only found ${selected.length} likely chat models, need ${REQUIRED_MODEL_COUNT}.`,
    );
  }

  return selected.slice(0, REQUIRED_MODEL_COUNT);
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\s*/, "");
  return withoutOpening.replace(/\s*```$/, "").trim();
}

function tryParseJson(text) {
  const cleaned = stripCodeFence(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function strictJsonOnly(text) {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") && !trimmed.includes("```");
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function evaluateJsonInstructionPrompt(outputText) {
  const parsed = tryParseJson(outputText);
  const expectedKeys = ["actions", "confidence", "hazards", "location", "risk_score"];
  const keys = parsed && typeof parsed === "object" ? Object.keys(parsed).sort() : [];
  const exactKeys = sameStringArray(keys, expectedKeys);
  const locationOk = parsed?.location === "Austin, TX";
  const hazardsOk = sameStringArray(parsed?.hazards, ["flood", "heat", "wildfire"]);
  const riskOk = parsed?.risk_score === 67;
  const confidenceOk =
    typeof parsed?.confidence === "number" && Math.abs(parsed.confidence - 0.84) < 1e-6;
  const actionsOk =
    Array.isArray(parsed?.actions) &&
    parsed.actions.length === 2 &&
    parsed.actions.every((action) => typeof action === "string" && action.trim().length >= 4);

  const complianceChecks = [
    strictJsonOnly(outputText),
    parsed !== null,
    exactKeys,
    locationOk,
    hazardsOk,
    riskOk,
    confidenceOk,
    actionsOk,
  ];
  const correctnessChecks = [locationOk, hazardsOk, riskOk, confidenceOk];

  return {
    complianceScore: mean(complianceChecks.map(Number)),
    correctnessScore: mean(correctnessChecks.map(Number)),
    details: {
      strictJson: complianceChecks[0],
      parseableJson: complianceChecks[1],
      exactKeys,
      locationOk,
      hazardsOk,
      riskOk,
      confidenceOk,
      actionsOk,
    },
  };
}

function evaluateRiskAdvisoryPrompt(outputText) {
  const trimmed = outputText.trim();
  const nonEmptyLines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bulletLines = nonEmptyLines.filter((line) => line.startsWith("- "));
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const exactThreeBullets = nonEmptyLines.length === 3 && bulletLines.length === 3;
  const withinWordRange = wordCount >= 70 && wordCount <= 90;
  const hasFloodInsurance = /flood insurance/i.test(trimmed);
  const hasSumpPump = /sump pump/i.test(trimmed);
  const hasEvacuationRoute = /evacuation route/i.test(trimmed);
  const noDisclaimer = !/\b(informational purposes|consult|no guarantee|not a substitute)\b/i.test(
    trimmed,
  );
  const calmTone = !trimmed.includes("!");

  const complianceChecks = [
    exactThreeBullets,
    withinWordRange,
    hasFloodInsurance,
    hasSumpPump,
    hasEvacuationRoute,
    noDisclaimer,
    calmTone,
  ];

  return {
    complianceScore: mean(complianceChecks.map(Number)),
    correctnessScore: null,
    details: {
      exactThreeBullets,
      withinWordRange,
      wordCount,
      hasFloodInsurance,
      hasSumpPump,
      hasEvacuationRoute,
      noDisclaimer,
      calmTone,
    },
  };
}

function evaluateReasoningPrompt(outputText) {
  const parsed = tryParseJson(outputText);
  const expectedKeys = ["after_two_hours", "explanation", "threshold_triggered"];
  const keys = parsed && typeof parsed === "object" ? Object.keys(parsed).sort() : [];
  const exactKeys = sameStringArray(keys, expectedKeys);
  const afterTwoHoursIsNumber = typeof parsed?.after_two_hours === "number";
  const thresholdIsBoolean = typeof parsed?.threshold_triggered === "boolean";
  const explanationOk =
    typeof parsed?.explanation === "string" &&
    parsed.explanation.trim().length > 0 &&
    parsed.explanation.trim().split(/\s+/).length <= 20;
  const numericAnswerOk = parsed?.after_two_hours === 12;
  const thresholdAnswerOk = parsed?.threshold_triggered === true;

  const complianceChecks = [
    strictJsonOnly(outputText),
    parsed !== null,
    exactKeys,
    afterTwoHoursIsNumber,
    thresholdIsBoolean,
    explanationOk,
  ];
  const correctnessChecks = [numericAnswerOk, thresholdAnswerOk];

  return {
    complianceScore: mean(complianceChecks.map(Number)),
    correctnessScore: mean(correctnessChecks.map(Number)),
    details: {
      strictJson: complianceChecks[0],
      parseableJson: complianceChecks[1],
      exactKeys,
      afterTwoHoursIsNumber,
      thresholdIsBoolean,
      explanationOk,
      numericAnswerOk,
      thresholdAnswerOk,
    },
  };
}

function computeLatencyScore(meanLatencyMs, minLatencyMs, maxLatencyMs) {
  if (maxLatencyMs === minLatencyMs) {
    return 100;
  }
  const normalized = (maxLatencyMs - meanLatencyMs) / (maxLatencyMs - minLatencyMs);
  return roundTo(Math.max(0, Math.min(1, normalized)) * 100, 2);
}

function printSummary(results) {
  const ordered = [...results].sort(
    (left, right) => right.metrics.overallWeightedScore - left.metrics.overallWeightedScore,
  );

  process.stdout.write("\nTop models by overall weighted score:\n");
  ordered.forEach((entry, index) => {
    process.stdout.write(
      `${index + 1}. ${entry.model} | overall=${entry.metrics.overallWeightedScore} | success=${
        entry.metrics.successRatePct
      }% | latency=${entry.metrics.meanLatencyMs}ms\n`,
    );
  });
}

async function main() {
  const env = await loadDotEnv(ENV_PATH);
  const apiKey = process.env.NVIDIA_NIM_API_KEY ?? env.NVIDIA_NIM_API_KEY;
  const baseUrl =
    process.env.NVIDIA_NIM_BASE_URL ?? env.NVIDIA_NIM_BASE_URL ?? DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error("NVIDIA_NIM_API_KEY is missing in environment or .env.local");
  }

  process.stdout.write(`Using NIM endpoint: ${normalizeBaseUrl(baseUrl)}\n`);
  process.stdout.write("Discovering available models from /v1/models...\n");

  const availableModelIds = await fetchModelIds({ baseUrl, apiKey });
  const selectedModels = selectTopModels(availableModelIds);

  process.stdout.write(
    `Selected ${selectedModels.length} models for benchmarking:\n${selectedModels
      .map((modelId) => `- ${modelId}`)
      .join("\n")}\n`,
  );

  const modelRuns = [];

  for (const model of selectedModels) {
    process.stdout.write(`\nBenchmarking model: ${model}\n`);
    const promptRuns = [];

    for (const prompt of PROMPTS) {
      process.stdout.write(`  - Running prompt: ${prompt.id}\n`);

      const completion = await postChatCompletion({
        baseUrl,
        apiKey,
        model,
        prompt,
      });

      const evaluation = completion.success
        ? prompt.evaluate(completion.outputText)
        : {
            complianceScore: 0,
            correctnessScore: null,
            details: { error: completion.error ?? "Request failed" },
          };

      promptRuns.push({
        promptId: prompt.id,
        description: prompt.description,
        success: completion.success,
        status: completion.status,
        latencyMs: completion.latencyMs,
        error: completion.error,
        outputText: completion.outputText,
        complianceScore: roundTo(evaluation.complianceScore * 100, 2),
        correctnessScore:
          evaluation.correctnessScore === null
            ? null
            : roundTo(evaluation.correctnessScore * 100, 2),
        evaluationDetails: evaluation.details,
      });
    }

    const successRate = mean(promptRuns.map((run) => Number(run.success)));
    const meanLatencyMs = mean(promptRuns.map((run) => run.latencyMs));
    const complianceScore = mean(promptRuns.map((run) => run.complianceScore));
    const correctnessValues = promptRuns
      .map((run) => run.correctnessScore)
      .filter((value) => typeof value === "number");
    const correctnessScore = mean(correctnessValues);

    modelRuns.push({
      model,
      metrics: {
        successRatePct: roundTo(successRate * 100, 2),
        meanLatencyMs: roundTo(meanLatencyMs, 2),
        parseabilityComplianceScore: roundTo(complianceScore, 2),
        simpleTaskCorrectnessScore: roundTo(correctnessScore, 2),
      },
      promptRuns,
    });
  }

  const latencies = modelRuns.map((entry) => entry.metrics.meanLatencyMs);
  const minLatencyMs = Math.min(...latencies);
  const maxLatencyMs = Math.max(...latencies);

  const scoringWeights = {
    successRate: 0.3,
    parseabilityCompliance: 0.25,
    simpleTaskCorrectness: 0.3,
    latency: 0.15,
  };

  for (const modelRun of modelRuns) {
    const latencyScore = computeLatencyScore(
      modelRun.metrics.meanLatencyMs,
      minLatencyMs,
      maxLatencyMs,
    );
    const overallWeightedScore =
      modelRun.metrics.successRatePct * scoringWeights.successRate +
      modelRun.metrics.parseabilityComplianceScore *
        scoringWeights.parseabilityCompliance +
      modelRun.metrics.simpleTaskCorrectnessScore *
        scoringWeights.simpleTaskCorrectness +
      latencyScore * scoringWeights.latency;

    modelRun.metrics.latencyScore = latencyScore;
    modelRun.metrics.overallWeightedScore = roundTo(overallWeightedScore, 2);
  }

  const ranking = [...modelRuns]
    .sort((left, right) => right.metrics.overallWeightedScore - left.metrics.overallWeightedScore)
    .map((entry, index) => ({
      rank: index + 1,
      model: entry.model,
      overallWeightedScore: entry.metrics.overallWeightedScore,
    }));

  const output = {
    generatedAt: new Date().toISOString(),
    nimBaseUrl: normalizeBaseUrl(baseUrl),
    availableModelCount: availableModelIds.length,
    selectedModels,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    prompts: PROMPTS.map((prompt) => ({
      id: prompt.id,
      description: prompt.description,
    })),
    scoringWeights,
    minLatencyMs,
    maxLatencyMs,
    ranking,
    recommendedModelId: ranking[0]?.model ?? null,
    modelRuns,
  };

  await mkdir(resolve("data"), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  process.stdout.write(`\nBenchmark results written to ${OUTPUT_PATH}\n`);
  printSummary(modelRuns);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
