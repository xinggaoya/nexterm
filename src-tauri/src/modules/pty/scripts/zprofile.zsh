# nexterm-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _nexterm_user_zdotdir="${NEXTERM_USER_ZDOTDIR:-$HOME}"
  [ -f "$_nexterm_user_zdotdir/.zprofile" ] && source "$_nexterm_user_zdotdir/.zprofile"
  unset _nexterm_user_zdotdir
}
:
