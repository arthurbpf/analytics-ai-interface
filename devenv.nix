{pkgs, ...}: {
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
    lsp.enable = false;
  };

  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    extensions = extensions: [extensions.pgvector];
    listen_addresses = "127.0.0.1";
    initialDatabases = [
      {name = "analytics";}
      {name = "analytics_test";}
    ];
  };

  git-hooks.hooks.conventional-commits = {
    enable = true;
    name = "Check Conventional Commits";
    package = pkgs.commitizen;
    entry = "${pkgs.commitizen}/bin/cz check --commit-msg-file";
    stages = ["commit-msg"];
  };

  git-hooks.hooks.format = {
    enable = true;
    name = "Check formatting";
    entry = "pnpm format:check";
    pass_filenames = false;
    always_run = true;
  };

  packages = [
    pkgs.chromium
    pkgs.git
    pkgs.nixfmt
    pkgs.railway
    pkgs.shellcheck
    pkgs.google-cloud-sdk
  ];

  env.PNPM_HOME = "${builtins.toString ./.}/.devenv/pnpm";
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "${pkgs.chromium}/bin/chromium";
}
