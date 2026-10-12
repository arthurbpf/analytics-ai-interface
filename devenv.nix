{ pkgs, ... }:
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
    lsp.enable = false;
  };

  packages = [
    pkgs.git
    pkgs.nixfmt
    pkgs.shellcheck
  ];

  env.PNPM_HOME = "${builtins.toString ./.}/.devenv/pnpm";
}
