# Categories

Every video is classified into one of these categories (from its title, channel, description, tags and
the start of its captions, without watching it) before any analysis. The action decides what happens:

- `full`: both AI notes (knowledge and visual description)
- `knowledge`: only the knowledge note (no visual description)
- `skip`: no AI notes

Edit freely: add, rename or remove rows, or change an action. The category name must be lowercase
kebab-case. Already classified videos keep their category; run with `--reclassify` to classify again.

| Category | Action | Description |
| :--- | :--- | :--- |
| maker-diy | full | Building, repairing or modifying physical things: 3D printing, electronics, robotics, woodworking, metalworking, vehicle builds and mods, workshop projects. |
| tutorial | full | Step-by-step teaching of a skill or tool: programming, software, design tools, Blender, configuration, "how to" guides. |
| engineering-science | full | Explanations of how things work: engineering, physics, chemistry, mechanics, technology deep dives, experiments. |
| talk-lecture | full | Conference talks, university lectures, courses and long-form classes. |
| review | full | Reviews, tests and comparisons of products, tools, hardware or software. |
| tech-news | knowledge | News, commentary and analysis about technology, AI, companies and products. |
| podcast-interview | knowledge | Podcasts, interviews and panel conversations, mostly people talking. |
| business-career | knowledge | Startups, entrepreneurship, business, productivity, careers and self-improvement advice. |
| music | skip | Music videos, songs, live performances, lyric videos, music mixes and playlists. |
| entertainment | skip | Comedy, sketches, reactions, drama, vlogs, challenges, pranks and general entertainment. |
| gaming | skip | Gameplay, let's plays, game trailers, game news and gaming drama. |
| story-recap | skip | Film, series or anime recaps, story narrations, movie and TV commentary. |
| motivation-ambient | skip | Motivational speeches, compilations, ambient, relaxing or background videos. |
| unknown | skip | Not enough information to tell what the video is about. |
