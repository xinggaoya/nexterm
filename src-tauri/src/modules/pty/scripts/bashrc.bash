# nexterm-shell-integration (bashrc)
#
# Emits OSC 7 (cwd) via PROMPT_COMMAND so the host can track the current
# working directory without re-parsing the prompt.
#
# We emulate login-shell init manually (/etc/profile, profile files) because
# bash ignores --rcfile when started with -l.

if [ -z "$__NEXTERM_HOOKS_LOADED" ]; then
  __NEXTERM_HOOKS_LOADED=1

  [ -f /etc/profile ] && source /etc/profile
  [ -f /etc/bashrc ] && source /etc/bashrc
  if [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile"
  elif [ -f "$HOME/.bash_login" ]; then
    source "$HOME/.bash_login"
  elif [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
  fi
  [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

  _nexterm_urlencode() {
    local LC_ALL=C s="$1" i c
    for (( i=0; i<${#s}; i++ )); do
      c="${s:i:1}"
      case "$c" in
        [a-zA-Z0-9/._~-]) printf '%s' "$c" ;;
        *) printf '%%%02X' "'$c" ;;
      esac
    done
  }

  _nexterm_precmd() {
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-$(uname -n 2>/dev/null)}" "$(_nexterm_urlencode "$PWD")"
  }

  case ":${PROMPT_COMMAND:-}:" in
    *":_nexterm_precmd:"*) ;;
    *) PROMPT_COMMAND="_nexterm_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac

  _nexterm_precmd
fi
:
