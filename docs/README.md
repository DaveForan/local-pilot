# local-pilot docs

This directory ships the project's [GitHub Pages](https://pages.github.com/)
site. The landing page lives in [`index.md`](index.md).

To preview locally with the Cayman Jekyll theme:

```sh
gem install bundler jekyll
bundle init
echo "gem \"github-pages\", group: :jekyll_plugins" >> Gemfile
bundle install
bundle exec jekyll serve --source docs --destination _site
```

To publish: in the GitHub repository, **Settings → Pages → Branch: main /
docs**. Done.

To replace screenshots, drop files into `docs/screenshots/` and reference
them from `index.md`.
