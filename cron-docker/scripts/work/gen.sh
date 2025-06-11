#!/bin/sh
# 这是一个兼容 POSIX sh 的脚本，用于从日刊 Markdown 文件生成一个摘要文件。

# 检查是否提供了目录参数
if [ -z "$1" ]; then
  echo "用法: $0 <存放markdown文件的目录路径>"
  echo "例如: $0 path/to/your/daily_notes"
  exit 1
fi

TARGET_DIR="$1" # 例如 path/to/your/daily_notes

# 1. 确定 TARGET_DIR 的父目录 和 TARGET_DIR 的基本名称
# dirname 和 basename 是 POSIX 标准工具
PARENT_OF_TARGET_DIR=$(dirname "$TARGET_DIR")
TARGET_DIR_BASENAME=$(basename "$TARGET_DIR")

# 如果父目录是 '.', 则实际路径前缀为空，否则为 "父目录/"
# 这用于构建输出文件的完整路径，同时确保相对路径的简洁性
if [ "$PARENT_OF_TARGET_DIR" = "." ]; then
  OUTPUT_PATH_PREFIX=""
else
  OUTPUT_PATH_PREFIX="${PARENT_OF_TARGET_DIR}/"
  # 确保父目录存在，如果不存在则创建
  # mkdir -p 虽然不是最基础的 POSIX 标准，但在几乎所有现代系统中都可用
  mkdir -p "$PARENT_OF_TARGET_DIR"
fi

OUTPUT_FILE="${OUTPUT_PATH_PREFIX}SUMMARY.md"

# 确保目标目录存在
if [ ! -d "$TARGET_DIR" ]; then
  echo "错误: 目录 '$TARGET_DIR' 不存在。"
  exit 1
fi

# 查找所有 YYYY-MM-DD.md 格式的文件路径，并按名称反向排序（最新日期在前）
# 使用 find 和 sort，这是非常标准和可移植的方法。
# 将结果存储在一个换行符分隔的字符串变量中。
files_paths=$(find "$TARGET_DIR" -maxdepth 1 -type f -name "????-??-??.md" | sort -r)

# 检查是否找到了任何文件
if [ -z "$files_paths" ]; then
  echo "在目录 '$TARGET_DIR' 中没有找到 'YYYY-MM-DD.md' 格式的文件。"
  echo "# Summary" > "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "<!-- 未找到日刊文件 -->" >> "$OUTPUT_FILE"
  echo "$OUTPUT_FILE 已在 '$PARENT_OF_TARGET_DIR' (或当前目录) 中生成。"
  exit 0
fi

# --- 复制最新文件到 TARGET_DIR 的父目录 ---
# 从已排序的列表中获取最新的文件（第一行）
latest_file_path=$(echo "$files_paths" | head -n 1)
latest_file_basename=$(basename "$latest_file_path")

if [ -n "$latest_file_basename" ]; then
    source_file_path="$latest_file_path"
    destination_file_path="${OUTPUT_PATH_PREFIX}${latest_file_basename}"

    copy_needed="true"
    # 检查源文件和目标文件是否是同一个。realpath 不是 POSIX 标准，但脚本会检查它是否存在。
    if command -v realpath >/dev/null 2>&1; then
        abs_source_file_path=$(realpath "$source_file_path")
        if [ -f "$destination_file_path" ]; then
            abs_destination_file_path=$(realpath "$destination_file_path")
            # 使用 POSIX 标准的 `=` 进行字符串比较
            if [ "$abs_source_file_path" = "$abs_destination_file_path" ]; then
                echo "最新的文件 '${source_file_path}' 已在目标位置 '${destination_file_path}'，无需复制。"
                copy_needed="false"
            fi
        fi
    else
        echo "警告: 'realpath' 命令未找到。如果源文件和目标位置相同，可能会尝试重复复制。"
        if [ "$source_file_path" = "$destination_file_path" ]; then
             echo "最新的文件 '${source_file_path}' 已在目标位置 '${destination_file_path}' (基于路径比较)，无需复制。"
             copy_needed="false"
        fi
    fi

    if [ "$copy_needed" = "true" ]; then
        echo "正在复制 '${source_file_path}' 到 '${destination_file_path}'..."
        if cp "$source_file_path" "$destination_file_path"; then
            echo "最新文件复制成功。"
        else
            echo "警告: 将最新文件复制到 '${destination_file_path}' 失败。请检查权限和路径。"
        fi
    fi
else
    echo "未找到最新文件，无法执行复制操作。"
fi
# --- 复制结束 ---


# 开始写入 SUMMARY.md
echo "# Summary" > "$OUTPUT_FILE"

# 写入 "Today" 链接 (指向复制到父目录的文件)
if [ -n "$latest_file_basename" ]; then
  echo "" >> "$OUTPUT_FILE"
  echo "[Today]($latest_file_basename)" >> "$OUTPUT_FILE"
else
  echo "<!-- 未找到最新文件 -->" >> "$OUTPUT_FILE"
fi

current_month_header=""

# 使用 while read 循环逐行处理文件路径列表，这是处理多行文本的标准 sh 做法
echo "$files_paths" | while read -r file_path_from_list; do
  # 在循环内为每一行获取文件名
  filename_basename=$(basename "$file_path_from_list")

  # 使用 cut 命令进行子字符串提取，以兼容 sh (${var:offset:length} 是 bash 专有语法)
  year_month=$(echo "$filename_basename" | cut -c1-7)  # "YYYY-MM"
  month_day_part=$(echo "$filename_basename" | cut -c6-10) # "MM-DD"

  if [ "$year_month" != "$current_month_header" ]; then
    echo "" >> "$OUTPUT_FILE"
    echo "# $year_month" >> "$OUTPUT_FILE"
    current_month_header="$year_month"
  fi

  link_text="${month_day_part}-日刊"
  # 链接路径是相对于 SUMMARY.md 的，指向原始目录中的文件
  link_path="${TARGET_DIR_BASENAME}/${filename_basename}"

  echo "- [$link_text]($link_path)" >> "$OUTPUT_FILE"
done

echo "" # 在文件末尾添加一个空行
echo "SUMMARY.md 文件已在 '${OUTPUT_FILE}' 生成。"
if [ "$PARENT_OF_TARGET_DIR" = "." ]; then
    echo " (即当前工作目录的 SUMMARY.md)"
else
    echo " (即目录 '${PARENT_OF_TARGET_DIR}' 下的 SUMMARY.md)"
fi