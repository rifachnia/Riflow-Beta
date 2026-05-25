function endpoint(baseUrl) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  if (!clean) throw new Error("LLM baseUrl is not configured");
  return `${clean}/chat/completions`;
}

export function hasAiConfig(config) {
  const provider = activeProvider(config);
  return Boolean(config.llm?.enabled && provider?.baseUrl && provider?.apiKey && provider?.model);
}

export async function chatJson(config, messages, schemaHint = "", providerOverride = null) {
  const provider = providerOverride || activeProvider(config);
  if (!provider?.apiKey || !provider?.model) {
    throw new Error("LLM is not configured. Add .env or keep inheritEnvPath pointed to your existing MiMo env.");
  }
  const type = provider.type || "openai-compatible";
  if (type === "anthropic") return chatAnthropic(config, provider, messages, schemaHint);
  if (type === "gemini") return chatGemini(config, provider, messages, schemaHint);
  return chatOpenAiCompatible(config, provider, messages, schemaHint);
}

export async function chatText(config, prompt, providerOverride = null) {
  const provider = providerOverride || activeProvider(config);
  if (!provider?.apiKey || !provider?.model) {
    throw new Error("LLM is not configured. Add .env or provider API key first.");
  }
  const type = provider.type || "openai-compatible";
  if (type === "anthropic") return textAnthropic(config, provider, prompt);
  if (type === "gemini") return textGemini(config, provider, prompt);
  return textOpenAiCompatible(config, provider, prompt);
}

async function chatOpenAiCompatible(config, provider, messages, schemaHint) {
  if (!provider?.baseUrl) throw new Error("LLM baseUrl is not configured");
  const response = await fetch(endpoint(provider.baseUrl), {
    method: "POST",
    signal: timeoutSignal(provider.timeoutMs ?? config.llm?.requestTimeoutMs ?? 60000),
    headers: {
      "Authorization": `Bearer ${provider.apiKey}`,
      "X-Api-Key": provider.apiKey,
      "api-key": provider.apiKey,
      "Accept-Encoding": "identity",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: Number(provider.temperature ?? config.llm.temperature ?? 0.2),
      max_tokens: Number(provider.maxTokens ?? config.llm.maxTokens ?? 700),
      ...openAiCompatibleExtras(provider),
      messages: [
        {
          role: "system",
          content: [
            "You are Riflow, a cautious paper-trading decision agent.",
            "Return strict JSON only. No markdown. No commentary.",
            "Never recommend live trading. Treat all actions as paper/simulation.",
            schemaHint
          ].filter(Boolean).join("\n")
        },
        ...messages
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM request failed ${response.status}: ${body.slice(0, 180)}`);
  }

  const data = await response.json();
  const text = extractText(data);
  return parseJson(text);
}

async function textOpenAiCompatible(config, provider, prompt) {
  if (!provider?.baseUrl) throw new Error("LLM baseUrl is not configured");
  const response = await fetch(endpoint(provider.baseUrl), {
    method: "POST",
    signal: timeoutSignal(provider.timeoutMs ?? config.llm?.requestTimeoutMs ?? 60000),
    headers: {
      "Authorization": `Bearer ${provider.apiKey}`,
      "X-Api-Key": provider.apiKey,
      "api-key": provider.apiKey,
      "Accept-Encoding": "identity",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: Number(provider.temperature ?? config.llm.temperature ?? 0.2),
      max_tokens: Number(provider.testMaxTokens ?? 500),
      ...openAiCompatibleExtras(provider),
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM request failed ${response.status}: ${body.slice(0, 180)}`);
  }
  const data = await response.json();
  return extractText(data);
}

async function chatAnthropic(config, provider, messages, schemaHint) {
  const baseUrl = (provider.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const system = [
    "You are Riflow, a cautious paper-trading decision agent.",
    "Return strict JSON only. No markdown. No commentary.",
    "Never recommend live trading. Treat all actions as paper/simulation.",
    schemaHint
  ].filter(Boolean).join("\n");

  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    signal: timeoutSignal(provider.timeoutMs ?? config.llm?.requestTimeoutMs ?? 60000),
    headers: {
      "x-api-key": provider.apiKey,
      "anthropic-version": provider.apiVersion || "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: provider.model,
      system,
      max_tokens: Number(provider.maxTokens ?? config.llm.maxTokens ?? 700),
      temperature: Number(provider.temperature ?? config.llm.temperature ?? 0.2),
      messages: messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.content || "")
      }))
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM request failed ${response.status}: ${body.slice(0, 180)}`);
  }
  const data = await response.json();
  const text = (data.content || []).map((part) => part.text || "").join("\n");
  return parseJson(text);
}

async function textAnthropic(config, provider, prompt) {
  const baseUrl = (provider.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    signal: timeoutSignal(provider.timeoutMs ?? config.llm?.requestTimeoutMs ?? 60000),
    headers: {
      "x-api-key": provider.apiKey,
      "anthropic-version": provider.apiVersion || "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 80,
      temperature: Number(provider.temperature ?? config.llm.temperature ?? 0.2),
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM request failed ${response.status}: ${body.slice(0, 180)}`);
  }
  const data = await response.json();
  return (data.content || []).map((part) => part.text || "").join("\n").trim();
}

async function chatGemini(config, provider, messages, schemaHint) {
  const baseUrl = (provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const prompt = [
    "You are Riflow, a cautious paper-trading decision agent.",
    "Return strict JSON only. No markdown. No commentary.",
    "Never recommend live trading. Treat all actions as paper/simulation.",
    schemaHint,
    ...messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
  ].filter(Boolean).join("\n\n");

  const response = await fetch(`${baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`, {
    method: "POST",
    signal: timeoutSignal(provider.timeoutMs ?? config.llm?.requestTimeoutMs ?? 60000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: Number(provider.temperature ?? config.llm.temperature ?? 0.2),
        maxOutputTokens: Number(provider.maxTokens ?? config.llm.maxTokens ?? 700)
      }
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM request failed ${response.status}: ${body.slice(0, 180)}`);
  }
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("\n");
  return parseJson(text);
}

async function textGemini(config, provider, prompt) {
  const baseUrl = (provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`, {
    method: "POST",
    signal: timeoutSignal(provider.timeoutMs ?? config.llm?.requestTimeoutMs ?? 60000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: Number(provider.temperature ?? config.llm.temperature ?? 0.2),
        maxOutputTokens: 80
      }
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM request failed ${response.status}: ${body.slice(0, 180)}`);
  }
  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("\n").trim();
}

function extractText(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content.map((part) => part.text || part.content || "").filter(Boolean).join("\n").trim();
    if (text) return text;
  }
  if (typeof choice?.text === "string" && choice.text.trim()) return choice.text.trim();
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (Array.isArray(data?.output)) {
    const text = data.output.flatMap((item) => item.content || [])
      .map((part) => part.text || part.content || "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function openAiCompatibleExtras(provider) {
  const tag = `${provider?.id || ""} ${provider?.name || ""} ${provider?.model || ""}`.toLowerCase();
  if (provider?.disableReasoning || tag.includes("mimo")) return { reasoning: { enabled: false } };
  if (provider?.reasoning === false) return { reasoning: { enabled: false } };
  return {};
}

function activeProvider(config) {
  const providers = config.llm?.providers || [];
  return providers.find((provider) => provider.id === config.llm?.activeProviderId) || providers[0] || config.llm;
}

function timeoutSignal(ms) {
  const timeout = Math.max(1000, Number(ms || 60000));
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeout);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeout).unref?.();
  return controller.signal;
}

export function parseJson(text) {
  const clean = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM did not return JSON");
    return JSON.parse(match[0]);
  }
}
