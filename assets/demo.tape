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

# 1 — version
Type "claude-token-lens --version"
Enter
Sleep 1.5s

# 2 — global status (short output, great hook)
Type "claude-token-lens status"
Enter
Sleep 5s

# 3 — report top 5 (quota bar + attribution table, no scrolling)
Type "claude-token-lens report --top 5 2>&1 | head -22"
Enter
Sleep 6s

# 4 — sessions inventory
Type "claude-token-lens sessions"
Enter
Sleep 4s

Sleep 2s
