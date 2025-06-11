#!/bin/sh

# 检查是否提供了目录参数
if [ -z "$1" ]; then
  echo "用法: $0 <目标目录>"
  echo "例如: $0 /path/to/your/directory"
  exit 1
fi

IMG_PROXY_URL=${IMG_PROXY_URL}  
TARGET_DIR="$1"

# 检查目录是否存在
if [ ! -d "$TARGET_DIR" ]; then
  echo "错误: 目录 '$TARGET_DIR' 不存在。"
  exit 1
fi

echo "将在目录 '$TARGET_DIR' 下的文件中执行以下替换："
echo "1. 'upload.chinaz.com' -> 'pic.chinaz.com'"
echo "2. 'https://pic.chinaz.com' -> '$IMG_PROXY_URL/?pp=https://pic.chinaz.com'"

# 定义替换规则
# 注意：
# - 第一个替换中的 '.' 需要转义，因为它在正则表达式中是特殊字符。
# - 第二个替换中的 '/' 在sed的s命令中是分隔符，所以我们需要使用其他分隔符，
#   例如 '#'，或者对规则中的 '/' 进行转义。使用其他分隔符更清晰。
# - 替换的顺序很重要。先将 upload.chinaz.com 替换为 pic.chinaz.com，
#   这样新生成的 pic.chinaz.com 才能被第二条规则匹配并加上代理。

RULE1_OLD="upload\.chinaz\.com" # 转义 '.'
RULE1_NEW="pic.chinaz.com"

RULE2_OLD_SED_SAFE="https://pic\.chinaz\.com" # 使用 '#' 作为分隔符，所以不需要转义 '/'，但 '.' 仍需转义
RULE2_NEW_SED_SAFE="$IMG_PROXY_URL/?pp=https://pic.chinaz.com" # URL中的'?'在替换部分不需要特殊处理

# 查找目录下的所有普通文件（排除目录和符号链接等）并执行替换
# 使用 -print0 和 xargs -0 来安全处理包含空格或特殊字符的文件名
# 或者使用 find ... -exec sed ... {} +
# 这里为了清晰，使用 find 和 while read 循环，同样能安全处理特殊文件名

find "$TARGET_DIR" -type f -print0 | while IFS= read -r -d $'\0' file; do
  echo "正在处理文件: $file"

  # 执行第一个替换
  sed -i "s/$RULE1_OLD/$RULE1_NEW/g" "$file"

  # 执行第二个替换 (使用 # 作为分隔符)
  sed -i "s#$RULE2_OLD_SED_SAFE#$RULE2_NEW_SED_SAFE#g" "$file"

  # 如果想在一个sed命令中完成，可以这样：
  # sed -i -e "s/$RULE1_OLD/$RULE1_NEW/g" -e "s#$RULE2_OLD_SED_SAFE#$RULE2_NEW_SED_SAFE#g" "$file"
  # 这样可以减少文件的读写次数，对于大文件或大量文件效率稍高。
  # 为了代码可读性，分开写了。

done

echo "替换完成。"