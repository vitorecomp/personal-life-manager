# {{ playlist.title | md }}

- **Created by me:** {{ playlist.created_by_me | yesno }}
<!-- keep:ai-full-description -->
- **AI Full Description:** [False]
<!-- /keep:ai-full-description -->

## Metadata

- **Playlist ID:** {{ playlist.id }}
- **URL:** {{ playlist.url }}
- **Owner:** {{ playlist.owner_name | link(playlist.owner_url) or "unknown" }}
- **Visibility:** {{ playlist.availability or "unspecified" }}
- **Videos:** {{ videos | length }}{% if playlist.youtube_video_count is not none and playlist.youtube_video_count != videos | length %} (YouTube reports {{ playlist.youtube_video_count }}){% endif +%}
- **Last updated on YouTube:** {{ playlist.modified_date | date }}
- **Views:** {{ playlist.view_count if playlist.view_count is not none else "unknown" }}
{% if playlist.description %}

**Description:**

{{ playlist.description | blockquote("> ") }}
{% endif %}

## ai-summary

{% for name, value in ai_flags.items() %}
- {{ name }}: [{{ value }}]
{% endfor %}

## Videos

{% for video in videos %}
{{ video.position }}. [{{ video.title | md }}]({{ video.note_link or video.url }}){% if video.note_link %} ([YouTube]({{ video.url }})){% endif %}{% if video.channel or video.duration_seconds %} - {{ [video.channel | md, video.duration_seconds | duration] | select | join(" | ") }}{% endif +%}
{% endfor %}
