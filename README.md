# Core Stitch

A full-stack Cloudflare Worker application that integrates a modern frontend with an agentic backend. This project showcases the Cloudflare Agents SDK combined with an Astro + React frontend featuring Shadcn UI components.

## Architecture

This is a **Single Worker Deployment** with strict code separation:

- **Backend (`./src/`)**: Worker entry point, Agent logic, D1 interactions, and MCP integration
- **Frontend (`./frontend/`)**: Astro + React application with Shadcn UI components
- **Build Pipeline**: The Astro app builds static assets that are served by the Worker alongside API endpoints

## Features

### Backend

- **Stateful Agent**: Built with the Cloudflare Agents SDK, wrapping OpenAI's API
- **MCP Integration**: Connects to the Stitch Remote MCP Server for extended capabilities
- **D1 Persistence**: Automatic message persistence using Cloudflare D1 database
- **UX Architect Persona**: Specialized agent for UX design discussions

### Frontend

- **Astro Framework**: Static site generation with Vite
- **React Components**: Modern UI with Shadcn UI (dark theme default)
- **Chat Interface**: Built with `@assistant-ui/react`
- **Thread History Sidebar**: Browse and switch between conversation threads

## Getting Started

### Prerequisites

- Node.js 18+ or 22+ (for Astro 6)
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account

### Setup

1. **Install dependencies**:

```bash
npm install
cd frontend && npm install
cd ..
```

2. **Configure environment variables**:

Copy `.dev.vars.example` to `.dev.vars` and fill in your API keys:

```bash
cp .dev.vars.example .dev.vars
```

Required variables:
- `OPENAI_API_KEY`: Your OpenAI API key
- `STITCH_API_KEY`: API key for the Stitch Remote MCP Server

3. **Create D1 database**:

```bash
wrangler d1 create stitch-db
```

Update `wrangler.toml` with the database ID returned.

4. **Initialize the database schema**:

```bash
npm run db:init
```

### Development

Run the development server:

```bash
# Terminal 1: Run the Worker
npm run dev

# Terminal 2: Run the frontend dev server (optional, for frontend-only changes)
npm run dev:frontend
```

### Building and Deployment

Build the frontend and deploy to Cloudflare:

```bash
npm run deploy
```

Or build separately:

```bash
npm run build:frontend  # Build frontend only
wrangler deploy         # Deploy to Cloudflare
```

## Project Structure

```
core-stitch/
├── src/
│   ├── agent.ts        # UX Architect Agent implementation
│   └── index.ts        # Worker entry point with Hono routing
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/             # Shadcn UI components
│   │   │   └── ChatInterface.tsx  # Main chat component
│   │   ├── layouts/
│   │   │   └── Layout.astro
│   │   ├── pages/
│   │   │   └── index.astro
│   │   ├── styles/
│   │   │   └── globals.css     # Tailwind + dark theme
│   │   └── lib/
│   │       └── utils.ts
│   ├── public/
│   │   └── favicon.svg
│   ├── astro.config.mjs
│   ├── tailwind.config.mjs
│   └── package.json
├── schema.sql              # D1 database schema
├── wrangler.toml          # Cloudflare Worker configuration
├── package.json           # Root package.json
└── tsconfig.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/threads` | GET | List all threads |
| `/api/threads` | POST | Create new thread |
| `/api/threads/:id` | GET | Get thread with messages |
| `/api/threads/:id` | DELETE | Delete a thread |
| `/api/chat` | POST | Send a message to the agent |
| `/api/agent/:id` | GET | WebSocket upgrade for real-time chat |

## Technologies

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Hono](https://hono.dev/) - Web framework
- [OpenAI API](https://platform.openai.com/) - LLM integration
- [Astro](https://astro.build/) - Frontend framework
- [React](https://react.dev/) - UI library
- [Shadcn UI](https://ui.shadcn.com/) - Component library
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [assistant-ui](https://www.assistant-ui.com/) - Chat interface components

## License

MIT