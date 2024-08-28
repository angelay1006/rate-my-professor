import {NextResponse} from  'next/server';
import {Pinecone} from '@pinecone-database/pinecone';
import OpenAI from 'openai';

// 3 steps: read data, make embedding, generate embedding w results

const systemPrompt = `
You are an AI assistant for a 'Rate My Professor' platform designed to help students find professors that best match their academic needs and preferences. When a student asks a question about professors (e.g., 'Who are the best Computer Science professors for AI research?' or 'Which professors are the most engaging for first-year students in Psychology?'), your goal is to retrieve the top 3 professors that best fit their query. To do this:

Understand the User Query: Carefully analyze the student's question to understand their specific needs, such as subject area, teaching style, research interests, course difficulty, etc.

Retrieve Relevant Information: Use Retrieval-Augmented Generation (RAG) to pull the most relevant data from the professor database, including student ratings, course offerings, research areas, and other pertinent details.

Present Top 3 Professors: Provide the names of the top 3 professors that best match the query, along with a brief description of why each professor is a good fit. Include key information such as course ratings, research areas, teaching styles, and any unique qualities that make them stand out.

Clarity and Precision: Ensure the recommendations are clear, concise, and directly address the student's question, making it easy for them to choose the best professor.`

export async function POST(req) {
    const data = await req.json()
    const pc = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
    });

    const index = pc.index('rag').namespace('ns1');
    const openai = new OpenAI();

    const text = data[data.length - 1].content;
    const embedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
    });

    const results = await index.query({
        topK: 3, 
        includeMetadata: true,
        vector: embedding.data[0].embedding,
    });

    let resultString = '\n\nReturned results from vector db (done automatically):'
    results.matches.forEach((match) => {
        resultString += `\n
        Professor: ${match.id}
        Review: ${match.metadata.stars}
        Subject: ${match.metadata.subject}
        Stars: ${match.metadata.stars}
        \n\n`
    });

    const lastMessage = data[data.length - 1];
    const lastMessageContent = lastMessage.content + resultString;
    const lastDataWithoutLastMessage = data.slice(0, data.length - 1);
    
    const completion = await openai.chat.completions.create({
        messages: [
            {role: 'system', content: systemPrompt},
            ...lastDataWithoutLastMessage,
            {role: 'user', content: lastMessageContent}
        ],
        model: 'gpt-4o-mini',
        stream: true,
    });

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            try {
                for await (const chunk of completion) {
                    const content = chunk.choices[0]?.delta?.content;
                    if (content) {
                        const text = encoder.encode(content);
                        controller.enqueue(text);
                    }
                }
            } catch (err) {
                controller.error(err);
            } finally {
                controller.close();
            }
        }
    })

    return new NextResponse(stream);
}