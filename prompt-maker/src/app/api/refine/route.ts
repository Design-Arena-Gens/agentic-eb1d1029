import { NextResponse } from "next/server";

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

type RefinePayload = {
  prompt: string;
  instructions?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  apiKey?: string;
};

const extractRefinedPrompt = (content: string | null | undefined) => {
  if (!content) return undefined;

  const codeBlockMatch = content.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  const finalPromptMatch = content.match(/(?:Final Prompt|Upgraded Prompt)[:\s]*([\s\S]*)/i);
  if (finalPromptMatch?.[1]) {
    return finalPromptMatch[1].trim();
  }

  return undefined;
};

export async function POST(request: Request) {
  let payload: RefinePayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const {
    prompt,
    instructions = "Rewrite this prompt to be clearer, safer, and more actionable.",
    provider = "openai",
    model = "gpt-4o-mini",
    temperature = 0.4,
    apiKey,
  } = payload;

  if (!prompt?.trim()) {
    return NextResponse.json({ error: "Prompt is required for refinement." }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: "API key is required to call the selected provider." }, { status: 400 });
  }

  const endpoint = PROVIDER_ENDPOINTS[provider];

  if (!endpoint) {
    return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  const messages = [
    {
      role: "system",
      content:
        "You are an elite prompt engineer. Critique the prompt, describe the upgrades, and then deliver a refined version that maximizes clarity, guardrails, and evaluation instructions.",
    },
    {
      role: "user",
      content: `PROMPT TO REFINE:\n${prompt}\n\nINSTRUCTIONS:\n${instructions}`,
    },
  ];

  const body = JSON.stringify({
    model,
    temperature,
    messages,
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(provider === "openrouter"
          ? { "HTTP-Referer": "https://prompt-maker-ai", "X-Title": "Prompt Maker AI" }
          : {}),
      },
      body,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          error:
            error?.error?.message ||
            error?.message ||
            "Provider returned a non-200 response. Check credentials and quota.",
        },
        { status: response.status },
      );
    }

    const data = await response.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;

    return NextResponse.json({
      analysis: content,
      refinedPrompt: extractRefinedPrompt(content),
    });
  } catch (error) {
    console.error("Refinement call failed", error);
    return NextResponse.json(
      { error: "Failed to contact the provider. Verify network and credentials." },
      { status: 500 },
    );
  }
}
