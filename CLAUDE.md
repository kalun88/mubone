# mubone.org — Project Brief & Claude Context

Read this at the start of every session to get up to speed fast.

## What is this project

Website for **mubone** — an experimental class of trombones with embedded orientation sensors, co-developed by Kalun Leung and Travis West since 2018. Built with Astro 5 + Tailwind CSS v4, hosted on Cloudflare Pages, content driven by Notion via the webtrotion integration pattern (same stack as kalunleung.ca and duoek.com).

Live site: **https://mubone.org**
GitHub repo: **https://github.com/kalun88/mubone**
Cloudflare Pages project: TBD (to be created)

## Tech Stack

- **Astro 5** — static site generator (`output: "static"`)
- **Tailwind CSS v4** — utility CSS via `@tailwindcss/vite` plugin
- **@notionhq/client** — Notion API for content
- **Cloudflare Pages** — hosting (auto-deploy on push to `main`)
- **Notion** — CMS (blog posts + project showcases)

### Stack Reference

The Notion-to-Astro rendering engine is adapted from `webtrotion-kalunleung`, which includes:
- `NotionBlocks.astro` — master block renderer that maps Notion block types to Astro components
- `src/components/notion-blocks/` — individual renderers for every Notion block type (paragraphs, headings, images, video, embeds, callouts, toggles, columns, tables, code, quotes, etc.)
- `src/lib/notion/client.ts` — Notion API client with caching, image optimization, block fetching
- `src/lib/interfaces.ts` — TypeScript interfaces for all Notion block types
- `src/lib/blog-helpers.ts` — helper functions for post links, references, heading IDs

**IMPORTANT**: Only the Notion rendering engine is carried over. No design, styles, layout, or content from kalunleung.ca or duoek.com.

---

## Design Spec

### Layout: okla.quebec-inspired (inverted to dark mode)

Two-column layout:
- **Left/main area** (~70%): Scrolling blog content — post listings on homepage, full post content on detail pages
- **Right sidebar** (~30%): Fixed/sticky info panel with site title, description, navigation links, contact, social links

This mirrors the okla.quebec layout but **inverted to dark mode**.

### Color Palette: monome.org-inspired

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#222222` | Page background (monome dark gray) |
| `--bg-surface` | `#303030` | Cards, sidebar, elevated surfaces |
| `--text` | `#ffffff` | Primary text |
| `--text-muted` | `#aaaaaa` | Secondary text, dates, metadata |
| `--text-dim` | `#555555` | Borders, very subtle elements |
| `--accent` | `#faf9f5` | Accent/highlight (monome warm white) |
| `--link` | `#aaaaaa` | Links (monome style — subtle, same as muted) |
| `--link-hover` | `#ffffff` | Link hover state |

### Typography

- **Font**: `"Roboto Mono", monospace` (matches monome.org aesthetic)
- **Style**: All lowercase feel, minimal, utilitarian
- **Body size**: ~14px
- **Generous whitespace** between elements

### Visual Characteristics

- Monospace throughout — code/tech aesthetic matching the research nature of mubone
- Thin horizontal rules as dividers (like monome.org)
- Images displayed large in content area
- Minimal decoration — content-forward
- No flashy hover effects — simple underline or color shift

---

## Content Architecture

### Notion Database: "mubone posts"

Single Notion database with these properties:

| Property | Type | Purpose |
|----------|------|---------|
| **Name** | Title | Post/project title |
| **Slug** | Rich Text | URL slug (e.g. `conversations-with-space-and-architecture`) |
| **Date** | Date | Publication/project date |
| **Type** | Select | `blog` or `project` — determines display style |
| **Show on Homepage** | Checkbox | Toggle to include/exclude from homepage listing |
| **Excerpt** | Rich Text | Short description for homepage card |
| **Featured Image** | Files & Media | Cover image for homepage card |
| **Published** | Checkbox | Must be checked to appear on site |
| **Tags** | Multi-select | Optional categorization |

### Page Types

#### 1. Blog Posts (`Type: blog`)
- Text-forward entries — research notes, updates, thoughts
- Homepage display: Title + date + excerpt in a simple list
- Detail page: Full Notion page content rendered via NotionBlocks

#### 2. Project Showcases (`Type: project`)
- Richer visual entries — performances, installations, collaborations
- Homepage display: Featured image + title + excerpt (more visual card)
- Detail page: Full Notion page content rendered via NotionBlocks
- Example: "Conversations with Space and Architecture" on kalunleung.ca

### Homepage Layout

```
┌─────────────────────────────────────┬──────────────────────┐
│                                     │  mubone              │
│  [PROJECT CARD with image]          │  ─────────────────── │
│  Conversations with Space...        │                      │
│  May 15, 2025                       │  an experimental     │
│                                     │  class of trombones  │
│  ─────────────────────────────────  │  with embedded       │
│                                     │  technologies...     │
│  blog post title                    │                      │
│  Feb 10, 2025 — excerpt text...     │  Travis West         │
│                                     │  Kalun Leung         │
│  ─────────────────────────────────  │                      │
│                                     │  → Instagram         │
│  blog post title                    │  → Email             │
│  Jan 5, 2025 — excerpt text...      │  → Publications      │
│                                     │                      │
│                                     │  Supported by the    │
│                                     │  Canada Council...   │
└─────────────────────────────────────┴──────────────────────┘
```

### Sidebar Content (right side, sticky)

- **Site title**: "mubone"
- **Dashed separator** (like okla.quebec)
- **Description**: Brief about the mubone project
- **People**: Travis West, Kalun Leung
- **Links**: → Instagram, → Email, → Publications (NIME, MOCO papers)
- **Acknowledgements**: Canada Council for the Arts, Harvestworks

---

## Mubone Copy (for placeholder/real use)

### Description
The mubone is an experimental class of trombones that has embedded technologies such as an orientation sensor (like the one used in smartphones). Musical instruments with sensors are commonly referred to as augmented instruments. When programmed to audio or visual processing software, augmented instruments have the potential for extending the creative range of the instrumentalists in ways we believe may offer a lifetime of exploration.

Travis West and I have been researching, developing, and creating with the mubone since 2018.

### Key Concepts
- **Augmentation**: Orientation sensor attached to tuning slide via nut-and-bolt system
- **Orientation tracking**: Tracks trombone direction as x/y vector data stream
- **Mapping**: Data controls software like Ableton, Max/MSP for spatial sound

### Artistic Research Areas
- Solo movement and sound performance
- Site-inspired improvisations
- Movement and dance collaborations
- Large ensemble works

### Publications
- 2022 NIME — "Early Prototypes and Artistic Practice with the Mubone"
- 2019 MOCO — "Mubone: An Augmented Trombone and Movement-Based Granular Synthesizer"

### Past Performances
CIRMMT Montreal (2023), The Vino Theatre Brooklyn (2022), IRCAM ManiFeste Paris (2022), IRCAM Forum Paris (2022), Record Shop Brooklyn (2022), Le Vivier Montreal (2021), Glass Box Theatre NYC (2021), Spectrum Brooklyn (2019), NYU (2019), The Stone NYC (2019)

---

## Infrastructure

### GitHub
- Repo: `https://github.com/kalun88/mubone.git`
- Username: `kalun88`
- Branch: `main`
- Status: Empty repo, ready for first push

### Cloudflare
- Domain `mubone.org` is registered and active in Cloudflare
- No Pages project exists yet — needs to be created
- Login: `kalunis@gmail.com`
- Will need: Pages project connected to `kalun88/mubone` GitHub repo
- Environment variables needed: `NOTION_API_SECRET`, `DATABASE_ID`
- Custom domain: `mubone.org` → Pages project

### Notion
- Uses same `NOTION_API_SECRET` as other sites (shared Notion integration token)
- Needs new database created specifically for mubone
- Database ID will be set as `DATABASE_ID` env var

---

## File Structure (target)

```
webtrotion-mubone/
├── astro.config.ts
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── .env.example
├── .gitignore
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── notion-blocks/        # Notion block renderers (from webtrotion)
│   │   │   ├── Paragraph.astro
│   │   │   ├── Heading1.astro
│   │   │   ├── ... (all block types)
│   │   │   └── annotations/
│   │   ├── NotionBlocks.astro    # Master block renderer
│   │   ├── Sidebar.astro         # Right sidebar
│   │   ├── PostCard.astro        # Blog post card for homepage
│   │   └── ProjectCard.astro     # Project card for homepage
│   ├── layouts/
│   │   ├── Base.astro            # HTML shell + two-column layout
│   │   └── Post.astro            # Single post layout
│   ├── lib/
│   │   ├── notion/
│   │   │   └── client.ts         # Notion API client (simplified from kalunleung)
│   │   └── interfaces.ts         # TypeScript interfaces
│   ├── pages/
│   │   ├── index.astro           # Homepage — list posts filtered by "Show on Homepage"
│   │   └── posts/
│   │       └── [slug].astro      # Dynamic post pages
│   └── styles/
│       └── global.css            # Tailwind + custom theme
└── tmp/                          # Build cache (gitignored)
```

---

## Phase 1: Starter Page (current goal)

Get a simple page live at mubone.org to verify the full pipeline:

1. ✅ GitHub repo created (`kalun88/mubone`)
2. ✅ Cloudflare domain active (`mubone.org`)
3. 🔲 Scaffold Astro project with Tailwind
4. 🔲 Create simple static homepage (dark theme, sidebar layout, placeholder content)
5. 🔲 Push to GitHub
6. 🔲 Create Cloudflare Pages project, connect to repo
7. 🔲 Add custom domain `mubone.org`
8. 🔲 Verify site is live

## Phase 2: Notion Integration

1. 🔲 Create Notion database with required properties
2. 🔲 Add Notion client and block renderers
3. 🔲 Wire up homepage to fetch from database
4. 🔲 Wire up [slug] pages for individual posts
5. 🔲 Add "Show on Homepage" toggle filtering
6. 🔲 Add blog vs project display differentiation

## Phase 3: Polish

1. 🔲 Responsive mobile layout (sidebar collapses)
2. 🔲 SEO/Open Graph meta tags
3. 🔲 RSS feed
4. 🔲 Publish webhook (like duoek's one-click publish)
5. 🔲 Migrate real content from Notion
