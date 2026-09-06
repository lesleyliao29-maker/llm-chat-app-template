type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

interface Env {
  OPENROUTER_API_KEY: string;
}

const MODEL_ID = "openai/gpt-5.4";

const LESLEY_PROMPT = `
你现在不是一个普通AI助手。

你是「Lesley / 廖廖」风格的情感咨询人格，服务于“神奇女孩聊天室”。

你的核心任务不是替用户做决定，也不是机械安慰，而是：
1. 听懂用户真正问的问题背后的心理动机。
2. 识别用户是不是在寻求认可、确定性、被选择感、价值确认，或者把决定权外包。
3. 先理解感受，再把用户拉回到“自己为什么会这么想”。
4. 不要一上来贴心理学标签，不要满嘴术语。
5. 不要使用鸡汤式排比，不要使用AI味很重的话，比如“你不是……而是……”“真正的答案其实在你心里”。
6. 语气要自然、聪明、直接，有一点锋利，但不冒犯。
7. 可以追问，而且追问要抓住用户刚才最值得注意的词。
8. 不要每次都写很长。根据问题决定长度。
9. 不要为了共情而共情。共情以后要继续往下拆。

Lesley的典型思路：

如果用户问：
“我要不要删他？”

不要直接回答“删”或“不删”。

更接近Lesley的回答方式是：
“我反而想先问你，你为什么会问我这个问题？
你现在真正想要的可能不是一个删除建议，而是想从我这里拿到一种认可：你这么做是对的。
那如果我说删，你希望删完以后发生什么？”

如果用户说：
“我明知道不该，但还是会这样。”

可以回应：
“其实这种模式反复出现，你自己难道不觉得痛苦吗？
我完全能理解这种感受，情感本身就是一个很难完全自控的过程。
但它当下映射的其实还是你自己。
我更想知道，你现在到底是在舍不得这个人，还是舍不得他曾经给过你的关注和价值确认？”

关于关系反复：
“我相信这种感觉总会过去，但不是靠强迫自己不想。
它更像一层一层脱敏，直到有一天你再看到同样的东西，真的没什么感觉。
到那个时候你才能享受感情本身，而不是借由对方对你的关注来寻找自己的价值。”

重要：
- 用户有时只想聊天，不要每一句都分析。
- 用户明显在情绪里时，先跟上情绪，再拆。
- 用户的问题如果很具体，可以直接回答一部分，再继续追问。
- 不要装神秘，不要故作高深。
- 不要自称心理医生、治疗师或临床专家。
- 不要说“作为AI”。
- 你就是聊天室里的Lesley人格。

说中文。
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/api/chat") {
      return new Response("Wonderful Girl AI is running.", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        }
      );
    }

    try {
      const body = (await request.json()) as {
        messages?: ChatMessage[];
      };

      const incomingMessages = Array.isArray(body.messages)
        ? body.messages
        : [];

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: LESLEY_PROMPT,
        },
        ...incomingMessages.filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        ),
      ];

      if (!env.OPENROUTER_API_KEY) {
        return new Response(
          JSON.stringify({
            error: "OPENROUTER_API_KEY is missing",
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          }
        );
      }

      const openRouterResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "X-Title": "Wonderful Girl Chatroom",
          },
          body: JSON.stringify({
            model: MODEL_ID,
            messages,
            stream: true,
            temperature: 0.85,
            max_tokens: 1200,
          }),
        }
      );

      if (!openRouterResponse.ok || !openRouterResponse.body) {
        const errorText = await openRouterResponse.text();

        console.error("OpenRouter error:", errorText);

        return new Response(
          JSON.stringify({
            error: "OpenRouter request failed",
            details: errorText,
          }),
          {
            status: 502,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          }
        );
      }

      const reader = openRouterResponse.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          let buffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();

                if (!trimmed.startsWith("data:")) continue;

                const data = trimmed.slice(5).trim();

                if (!data || data === "[DONE]") continue;

                try {
                  const json = JSON.parse(data);
                  const text =
                    json?.choices?.[0]?.delta?.content;

                  if (typeof text === "string" && text.length > 0) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          response: text,
                        })}\n\n`
                      )
                    );
                  }
                } catch {
                  // Ignore incomplete/non-JSON SSE lines.
                }
              }
            }
          } catch (error) {
            console.error("Streaming error:", error);

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  response: "\n\n连接刚才断了一下，请再发一次。",
                })}\n\n`
              )
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    } catch (error) {
      console.error("Chat error:", error);

      return new Response(
        JSON.stringify({
          error: "Failed to process chat request",
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        }
      );
    }
  },
};
