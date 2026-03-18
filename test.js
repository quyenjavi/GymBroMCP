import 'dotenv/config';
import { OpenAI } from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

async function test() {
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [
        { role: "user", content: "Say hello like a gym coach" }
      ],
    });

    console.log("✅ SUCCESS:");
    console.log(res.choices[0].message.content);

  } catch (err) {
    console.error("❌ ERROR:");
    console.error(err.message);
  }
}

test();