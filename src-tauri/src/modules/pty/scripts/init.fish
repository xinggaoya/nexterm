# nexterm-shell-integration (fish)
# Emits OSC 7 (cwd) so the host tracks the current working directory.

if set -q __NEXTERM_HOOKS_LOADED
    exit 0
end
set -g __NEXTERM_HOOKS_LOADED 1

set -g __NEXTERM_HOST (uname -n 2>/dev/null; or echo localhost)

function __nexterm_urlencode_path
    set -l parts (string split '/' -- $argv[1])
    set -l out
    for p in $parts
        if test -n "$p"
            set out $out (string escape --style=url -- $p)
        else
            set out $out ""
        end
    end
    string join '/' $out
end

if functions -q fish_prompt
    functions -c fish_prompt __nexterm_user_prompt
end

function fish_prompt
    printf '\e]7;file://%s%s\e\\' "$__NEXTERM_HOST" (__nexterm_urlencode_path "$PWD")
    if functions -q __nexterm_user_prompt
        __nexterm_user_prompt
    else
        printf '%s > ' (prompt_pwd)
    end
end
