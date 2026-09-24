# FluentKey Learn

## Official vocabulary source

The bundled NGSL 1.2 book contains 2,809 ranked entries from the official New General Service List Project. It retains each source lemma, SFI rank, SFI, and adjusted frequency per million. Chinese meanings, part of speech, IPA, and examples are optional learning content kept separately from the published statistics. See [NGSL source and CC BY-SA 4.0 attribution](src/data/NGSL-SOURCE.md).

我想做一个面向中文用户的英语单词与句子学习 Web App。

产品的核心体验可以参考 Qwerty Learner 的键盘打字背单词模式：用户通过键盘连续输入英文单词，在输入过程中获得即时、流畅、清晰的字符反馈。这种连续打字学习的手感是整个产品最重要的体验之一。

在这个基础上，我希望把它发展成一个更完整的 AI 英语词汇学习产品。

核心学习体验包括：

1. 单词拼写学习

   用户看到当前需要学习的英文单词，通过键盘逐字输入。

   系统记录正确、错误、完成时间等基本学习数据。

   输入错误后，界面提供一个很轻量的“误触”选项，让用户可以把上一次错误标记为误触，使学习记录更加准确。

   完成单词后可以播放发音，并自然进入下一个单词。

2. 句子拼写学习

   除了单词模式，还有完整句子的拼写模式。

   句子可以围绕用户正在学习的单词生成或选择，让用户通过实际语境加强记忆。

   完成整句拼写后展示自然的中文译文。

   在适合的简单句中，可以展示基础的主语、谓语、宾语结构，帮助用户快速理解句子结构。

   句子学习同样以连续键盘操作为主要交互方式。

3. 完成反馈

   单词或句子完成的一瞬间，希望有让人感到舒服且明确的完成反馈。

   可以通过细腻的动效、文字状态变化以及简短音效，让用户明显感知这一题已经完成，然后自然过渡到译文或下一题。

   整个学习过程应该有节奏感，适合长时间连续输入。

4. AI 学习助手

   系统会持续记录用户每天学习过的单词、答错的单词、误触记录、学习次数和基本进度。

AI 可以读取这些学习记录，并基于真实数据帮助用户：

了解今天学习了什么；

回顾经常出错的单词；

解释某个容易忘记的词；

根据当前学习过的词生成适合用户水平的例句；

生成复习内容或小测试；

回答与当前学习内容有关的问题。

AI 的定位是了解用户当前学习状态的英语学习助手，因此它提供的内容应该尽量和用户真实学过的词汇及记录产生联系。

5. 学习记录

   用户可以看到自己的学习进度，例如今天学习的词数、复习数量、错误记录、连续学习情况，以及已经学习过的词。

产品后续会接入正式授权的英语词库，所以当前可以使用合理的示例数据来呈现完整体验。

这是一个需要长期每天打开使用的学习产品，因此我很重视键盘操作的流畅程度、信息层级、节奏、细节反馈和整体完成度。

视觉设计、布局、组件形式、动画语言和整体设计风格希望由你根据这个产品定位自行发挥。希望它具有成熟现代 Web App 的质感，同时让学习界面保持专注、舒服、有沉浸感，并形成自己的视觉识别。

先围绕最核心的学习体验建立产品，包括首页/学习入口、单词拼写学习、句子拼写学习、学习完成反馈、基础学习记录以及 AI 学习助手入口。优先让我能够实际体验完整的学习流程。

我希望整体风格是高端 简约风格 主体可以使用浅色调但绝不能是深色调，你还有什么问题吗

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://vocab-rhythm.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1f4ce4e8-dfe0-4987-a5e3-b9ebab729f99).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
