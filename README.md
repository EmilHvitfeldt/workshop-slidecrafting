# Slidecrafting Workshop

A 2-hour hands-on workshop on making beautiful slides with reveal.js and Quarto, built as a Quarto website.

Companion to the [Slidecrafting book](https://slidecrafting-book.com).

## Structure

```
_quarto.yml        Website config (navbar + sidebar)
index.qmd          Landing page
schedule.qmd       Run of show
setup.qmd          Prerequisites
materials/         Five teaching modules (01–05)
slides/            One reveal.js deck per section (01–05)
styles.scss        Website theme
```

## Preview

```bash
quarto preview
```

## Publishing

Pushes to `main` render the site in GitHub Actions and publish it to the `gh-pages`
branch at <https://emilhvitfeldt.github.io/workshop-slidecrafting>.

CI does not install R. Executed chunks are replayed from the committed `_freeze/`
directory, so after adding or editing a code chunk, render locally and commit the
updated `_freeze/` files.

## Status

Scaffold only. Module bodies are marked with `<!-- TODO -->` and need content.
