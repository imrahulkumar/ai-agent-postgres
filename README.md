# ai-agent-postgres

A command-line AI agent that manages a todo list stored in PostgreSQL. You chat with it in plain English ("add a task to buy milk", "show my todos", "delete todo 3"), and it decides which database tool to call, runs it, and replies.

- **LLM:** Google Gemini (`gemini-3.5-flash-lite`) through Gemini's OpenAI-compatible endpoint, using the `openai` npm SDK
- **Database:** PostgreSQL 16 running in Docker
- **ORM / migrations:** Drizzle ORM + Drizzle Kit
- **Interface:** terminal prompt via `readline-sync`

---

## How it works

The agent runs a **plan → action → observation → output** loop:

```
You ──► "Add a task to buy groceries"
          │
          ▼
   Gemini (JSON mode) ──► { "type": "plan",   "plan": "I will use createTodo..." }
          │            ──► { "type": "action", "function": "createTodo", "input": "Buy groceries" }
          ▼
   index.js runs createTodo() against Postgres
          │
          ▼
   { "type": "observation", "observation": 4 }  ──► sent back to Gemini
          │
          ▼
   Gemini ──► { "type": "output", "output": "Your todo has been added." }
          │
          ▼
   🤖 Your todo has been added.
```

1. Your message is appended to the conversation history.
2. The model must answer with one JSON object (`response_format: json_object`).
3. If it returns an `action`, `index.js` looks up the function in the `tools` map, runs it, and feeds the result back as an `observation`.
4. The loop continues until the model returns an `output`, which is printed with 🤖.
5. If the model returns only a `plan`, the app sends `continue` so the model moves to the next step.

### Available tools

| Tool | Input | What it does |
| --- | --- | --- |
| `getAllTodos()` | — | Returns every todo |
| `createTodo(todo)` | todo text | Inserts a todo, returns its new `id` |
| `searchTodos(keyword)` | keyword | Case-insensitive `ILIKE '%keyword%'` search |
| `deleteTodoById(id)` | todo id | Deletes the todo with that id |

---

## Project structure

```
.
├── index.js              # Agent loop, system prompt, tool functions
├── db/
│   ├── index.js          # Drizzle client (reads DATABASE_URL)
│   └── schema.js         # Table definition
├── drizzle/              # Generated SQL migrations + snapshots
├── drizzle.config.js     # Drizzle Kit config
├── docker-compose.yaml   # Postgres 16 container
├── .env.example          # Template for environment variables
└── package.json
```

### Database schema

Defined in [db/schema.js](db/schema.js). The table is named `users` in Postgres but holds todos (exported as `todosTable`):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key, auto-generated identity |
| `todo` | text | Required |
| `created_at` | timestamp | Defaults to `now()` |
| `updated_at` | timestamp | Set by Drizzle on update |

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- [Docker](https://www.docker.com/) with Docker Compose
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

---

## Setup: end to end

### 1. Clone and install

```bash
git clone <your-repo-url> ai-agent-with-postgres
cd ai-agent-with-postgres
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgres://admin:admin@localhost:5432/mydb
GEMINI_API_KEY=your-gemini-api-key
```

> Don't put a `;` at the end of a line. `dotenv` keeps it as part of the value, so the database name would become `mydb;` and the connection would fail.

The credentials in `DATABASE_URL` match the ones in [docker-compose.yaml](docker-compose.yaml) (`admin` / `admin`, database `mydb`). If you change one, change the other.

### 3. Start PostgreSQL

```bash
docker compose up -d
```

Check it's running:

```bash
docker compose ps
```

Data is kept in the `postgres_data` Docker volume, so it survives restarts.

### 4. Create the table

The migration is already generated in [drizzle/](drizzle/), so just apply it:

```bash
npm run migrate
```

### 5. Run the agent

```bash
node index.js
```

You'll see a `>>` prompt. Press `Ctrl+C` to quit.

---

## Example session

```
>> Add a task for shopping groceries
🤖 Can you tell me what items you want to shop for?
>> milk, bread and eggs
🤖 Your todo "Shopping for milk, bread and eggs" has been added.
>> what are my todos?
🤖 You have 1 todo: 1. Shopping for milk, bread and eggs
>> search for milk
🤖 I found 1 todo matching "milk": Shopping for milk, bread and eggs (id 1)
>> delete todo 1
🤖 Todo 1 has been deleted.
```

The model's exact wording varies from run to run.

---

## npm scripts

| Command | What it does |
| --- | --- |
| `npm run generate` | Generate a new migration after editing `db/schema.js` |
| `npm run migrate` | Apply pending migrations to the database |
| `npm run studio` | Open Drizzle Studio to browse the data in your browser |

### Changing the schema

1. Edit [db/schema.js](db/schema.js).
2. `npm run generate` to create a new migration in `drizzle/`.
3. `npm run migrate` to apply it.
4. If the agent should know about the new columns, update the schema section of `SYSTEM_PROMPT` in [index.js](index.js).

### Adding a tool

1. Write an `async` function in [index.js](index.js) that takes one input.
2. Add it to the `tools` object.
3. Describe it under "Available Tools" in `SYSTEM_PROMPT` so the model knows when to call it.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:5432` | Postgres isn't running. Run `docker compose up -d`. |
| `port 5432 is already allocated` | Another Postgres is using the port. Stop it, or change the host port in `docker-compose.yaml` and in `DATABASE_URL`. |
| `database "mydb;" does not exist` | Remove the trailing `;` from `DATABASE_URL` in `.env`. |
| `relation "users" does not exist` | Run `npm run migrate`. |
| `401` / `API key not valid` | Check your Gemini key in `.env`. |
| `SyntaxError: ... JSON` | The model returned something that isn't valid JSON. Retry the message. |

### Reset the database

This deletes all todos:

```bash
docker compose down -v
docker compose up -d
npm run migrate
```

---

## Security notes

- `.env` is listed in `.gitignore`. Keep real keys only there, never in `.env.example` or in source files.
- If a key has ever been committed, revoke it in Google AI Studio and create a new one. Removing it from the latest commit doesn't remove it from git history.
