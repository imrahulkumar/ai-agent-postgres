import { db } from './db/index.js';
import { todosTable } from './db/schema.js';
import readlineSync from 'readline-sync';
import OpenAI from 'openai';
import { eq, ilike } from 'drizzle-orm';

// Tools
async function getAllTodos() {
    const todos = await db.select().from(todosTable);
    return todos;
}

async function createTodo(todo) {
    const [result] = await db.insert(todosTable).values({ todo }).returning({ id: todosTable.id });
    return result.id;
}

async function searchTodos(keyword) {
    const result = await db.select().from(todosTable).where(ilike(todosTable.todo, `%${keyword}%`));
    return result;
}

async function deleteTodoById(id) {
    const result = await db.delete(todosTable).where(eq(todosTable.id, Number(id)));
    return result;
}

const OPEN_API_KEY = 'AQ.Ab8RN6JLKyZGmJ2YU_hVP1WSw4CwZbj7-eNNqVYzdvqOcwV0XA';
const OPENAI_MODEL = 'gemini-3.5-flash-lite';


const client = new OpenAI({
    apiKey: OPEN_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

const tools = {
    getAllTodos: getAllTodos,
    createTodo: createTodo,
    searchTodos: searchTodos,
    deleteTodoById: deleteTodoById
};


const SYSTEM_PROMPT = `You are an AI Assistant. You can manage task by adding, viewing, updating and deleteling
You must strickly follow the JOSN output format.
Respond with exactly ONE JSON object per response (never an array). Do one step at a time:
plan -> action -> wait for observation -> output.

Todo DB Schema:
id: Int and Primary key
todo: String
created_at: Date Time
updated_at: Date Time


Available Tools:
- function createTodo(todo: string): void
   Create a new todo item with the given todo string.

- function getAllTodos(): string[]
   Returns all the todo from database

- function searchTodos(keyword: string): string[]
   Search for all todos that match the given keyword.

- function deleteTodoById(id: number): void
   Deletes the todo item with the given id


Example:
START
{ "type": "user", "user": "Add a task for shopping groceries." }
{ "type": "plan", "plan": "I will try to get more context on what user needs to shop." }
{ "type": "output", "output": "Can you tell me what all items you want to shop for?" }
{ "type": "user", "user": "I want to shop for milk, kurkure, lays and choco." }
{ "type": "plan", "plan": "I will use createTodo to create a new Todo in DB." }
{ "type": "action", "function": "createTodo", "input": "Shopping for milk, kurkure, lays and choco." }
{ "type": "observation","observation":"2"},
{ "type": "output","output":"You todo has been added successfully"}
`;




const message = [
    { role: 'system', content: SYSTEM_PROMPT }
];

while (true) {

    const query = readlineSync.question('>>');
    message.push({ role: 'user', content: query });

    while (true) {
        const chat = await client.chat.completions.create({
            model: OPENAI_MODEL,
            messages: message,
            response_format: { type: 'json_object' }
        });

        const result = chat.choices[0].message.content;
        console.log('->', result);
        message.push({ role: 'assistant', content: result });

        // The model sometimes returns several steps as an array; run the action before trusting any output
        const parsed = JSON.parse(result);
        const steps = Array.isArray(parsed) ? parsed : [parsed];

        const output = steps.find(step => step.type === 'output');
        const action = steps.find(step => step.type === 'action');

        if (action) {
            const fn = tools[action.function];
            const observation = fn
                ? await fn(action.input)
                : `Unknown function: ${action.function}`;
            message.push({ role: 'user', content: JSON.stringify({ type: 'observation', observation }) });
        } else if (output) {
            console.log('🤖', output.output);
            break;
        } else {
            // Gemini rejects requests that end with an assistant message, so nudge it to the next step
            message.push({ role: 'user', content: 'continue' });
        }
    }
} 