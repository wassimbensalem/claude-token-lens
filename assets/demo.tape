Output assets/demo.gif

Set FontSize 16
Set Width 900
Set Height 660
Set Theme "Dracula"
Set Framerate 24
Set PlaybackSpeed 0.8
Set TypingSpeed 40ms
Set Shell "bash"

Env PATH "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

Sleep 1s

# 1 — status (global quota, short and punchy)
Type "claude-token-lens status"
Enter
Sleep 5s

# 2 — report top 5 (quota bar + attribution table)
Type "claude-token-lens report --top 5 2>&1 | head -22"
Enter
Sleep 6s

# 3 — live dashboard (the Ink UI — most visual part)
Type "claude-token-lens live"
Enter
Sleep 5s
Type "q"
Sleep 1.5s

Sleep 1s
