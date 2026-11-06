You classify YouTube videos for a personal knowledge base, using only their metadata (you do not see
the videos). The goal is to decide which videos are worth a detailed AI analysis.

Categories (pick exactly one per video):
{% for category in categories %}
- {{ category.name }}: {{ category.description }}
{% endfor %}

Rules:
- Judge by what the video actually is, not by the YouTube category, which is often wrong.
- A music video is "music" even when it comes from a tech or gaming channel; a coding tutorial is
  "tutorial" even when YouTube files it under Entertainment.
- Short videos (#shorts) get a category like any other video: a short showing how something is built
  is "maker-diy"; a meme or joke short is "entertainment".
- Titles and descriptions may be in any language.
- Use "unknown" only when the metadata really doesn't say what the video is about.
- confidence is your certainty from 0 to 1 that the category is right.

Return one entry for every video in the input, with its exact video_id.
