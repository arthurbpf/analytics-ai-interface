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

  packages = [
    pkgs.chromium
    pkgs.git
    pkgs.nixfmt
    pkgs.shellcheck
    pkgs.google-cloud-sdk
  ];

  env.PNPM_HOME = "${builtins.toString ./.}/.devenv/pnpm";
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "${pkgs.chromium}/bin/chromium";
}
