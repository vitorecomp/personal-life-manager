# {{ video.title | md }}

{% if video.unavailable_reason %}
> **Unavailable on YouTube:** {{ video.unavailable_reason }}

{% endif %}
## Metadata

- **Video ID:** {{ video.video_id }}
- **URL:** {{ video.url }}
- **Channel:** {{ video.channel | link(video.channel_url) or "unknown" }}
- **Uploaded:** {{ video.upload_date | date }}
- **Duration:** {{ video.duration_seconds | duration or "unknown" }}
- **Views:** {{ video.view_count | number }}
- **Likes:** {{ video.like_count | number }}
- **Comments:** {{ video.comment_count | number }}
- **Categories:** {{ video.categories | join(", ") or "none" }}
- **Tags:** {{ video.tags | join(", ") or "none" }}
- **Language:** {{ video.language or "unknown" }}
- **Live status:** {{ video.live_status or "unknown" }}
- **Age limit:** {{ video.age_limit if video.age_limit is not none else "unknown" }}
- **Availability:** {{ video.availability or "unspecified" }}
{% if video.thumbnail %}
- **Thumbnail:** {{ video.thumbnail }}
{% endif %}
{% if video.description %}

## Description

{{ video.description | fence }}
{% endif %}
{% if video.chapters %}

## Chapters

{% for chapter in video.chapters %}
- {{ chapter.start_seconds | duration or "0:00" }} {{ chapter.title }}
{% endfor %}
{% endif %}

## Latest comments ({{ video.comments | length }})

{% for comment in video.comments %}
- **{{ comment.author | md }}**{% if comment.is_pinned %} (pinned){% endif %}{% if comment.author_is_uploader %} (uploader){% endif %} - {{ comment.date }} - {{ comment.like_count }} likes
{{ comment.text | blockquote("  > ") }}
{% else %}
_No comments fetched._
{% endfor %}
{% if video.transcript %}

## Transcript ({{ video.subtitle_lang }}, {{ video.subtitle_kind }} captions)

{{ video.transcript | fence }}
{% else %}

## Transcript

_No subtitles found in the video's original language._
{% endif %}
