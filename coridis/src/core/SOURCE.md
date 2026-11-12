# 复制的 DSH 核心源码

来源：https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core
提交：ce7073d51254c26cd63b22a60835b8f948deb447

模块：agent、agent-loop、session、scope、system-prompt、tools。
文件逐字复制自各模块的 `src/*.ts`；导入语句仍引用上游的 `@deepseek-ai/dsh-*` 包，
尚未接入本工作区。

上游许可证：MIT（见 deepseek-harness 仓库）。

每个模块同时保留了上游的 `README.md`。`agent/DEPENDENCIES.md` 记录了该模块的
内部依赖图和外部包的使用情况。
