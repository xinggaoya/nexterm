# nexterm-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) so the host can track the current working directory of
# the running shell without re-parsing the prompt.

{
  _nexterm_user_zdotdir="${NEXTERM_USER_ZDOTDIR:-$HOME}"
  [ -f "$_nexterm_user_zdotdir/.zshrc" ] && source "$_nexterm_user_zdotdir/.zshrc"
  unset _nexterm_user_zdotdir
}

if [[ -z "$__NEXTERM_HOOKS_LOADED" ]]; then
  __NEXTERM_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null

  _nexterm_urlencode() {
    emulate -L zsh
    setopt localoptions no_multibyte
    local LC_ALL=C s="$1" i byte
    for (( i=1; i<=${#s}; i++ )); do
      byte="${s[i]}"
      case "$byte" in
        [a-zA-Z0-9/._~-]) printf '%s' "$byte" ;;
        *) printf '%%%02X' "'$byte" ;;
      esac
    done
  }

  _nexterm_precmd() {
    printf '\e]7;file://%s%s\e\\' "${HOST}" "$(_nexterm_urlencode "$PWD")"
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _nexterm_precmd
  fi

  _nexterm_precmd
fi
:
