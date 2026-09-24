# NGSL 1.2 source and license

`ngsl-1.2-stats.csv` is the official **NGSL 1.2 with basic statistics** download from the [New General Service List Project](https://www.newgeneralservicelist.com/new-general-service-list). Its 2,809 rows contain the published lemma, SFI rank, SFI, and adjusted frequency per million. The only change to the downloaded CSV is normalized line endings.

The New General Service List is by Browne, C., Culligan, B., and Phillips, J. It is licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/). The source download is [NGSL 1.2 with basic statistics](https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv).

The project's optional Chinese meanings, parts of speech, IPA, and examples belong in `ngsl-1.2-learning.ts`. They are separate editorial learning content and are absent until supplied. Source rank, SFI, and frequency are read from the CSV and must not be overwritten by learning content.

The official site also publishes 52 supplementary words without frequency rankings. This bundled book uses the 2,809-row ranked NGSL 1.2 statistics file, so its order and frequency fields remain unambiguous.
