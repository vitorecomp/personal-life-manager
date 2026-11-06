"""Shared constants."""

# Titles YouTube shows in a playlist in place of a video that is gone.
PLACEHOLDER_REASONS = {"[Private video]": "private", "[Deleted video]": "deleted"}
# Asks the playlist browse call to include unavailable videos (hidden by default, like on youtube.com).
SHOW_UNAVAILABLE_PARAMS = "wgYCCAA="
REMOVALS_PER_REQUEST = 50
SPECIAL_PLAYLISTS = {"WL": "Watch later", "LL": "Liked videos"}
