Video metadata (from YouTube; may be incomplete or partly wrong, trust the video itself first):

- Title: {{ video.title }}
- Channel: {{ video.channel or "unknown" }}
- URL: {{ video.url }}
- Uploaded: {{ video.upload_date or "unknown" }}
- Duration: {{ video.duration or "unknown" }}
- Original language: {{ video.language or "unknown" }}
{% if video.tags %}
- Tags: {{ video.tags | join(", ") }}
{% endif %}
{% if video.chapters %}

Chapters defined by the uploader:
{% for chapter in video.chapters %}
- [{{ chapter.start }}] {{ chapter.title }}
{% endfor %}
{% endif %}
{% if video.description %}

Description written by the uploader:
<description>
{{ video.description }}
</description>
{% endif %}
{% if video.transcript %}

Caption track ({{ video.subtitle_kind }} captions, {{ video.subtitle_lang }}). Use it to get names, terms and
numbers right; it has no timestamps, so take timing from the video:
<transcript>
{{ video.transcript }}
</transcript>
{% endif %}
