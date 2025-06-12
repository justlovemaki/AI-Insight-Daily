#!/bin/sh

# --- 配置 ---
# 从环境变量读取，或者直接在此处设置
# 强烈建议使用环境变量以保证安全
GITHUB_TOKEN=${GITHUB_TOKEN}	# 替换 YOUR_GITHUB_PAT 或设置环境变量
OWNER=${OWNER}                			# 你的 GitHub 用户名或组织名
REPO=${REPO_NAME}                  		# 你的仓库名称
BRANCH="book"                                		# 目标分支 (可能是 main, master 等)

set -e # 如果任何命令失败，脚本将退出
set -o pipefail # 如果管道中的任何命令失败，则整个管道失败

# API基础URL
API_URL="https://api.github.com/repos/${OWNER}/${REPO}/contents"

# --- 帮助信息 ---
usage() {
  echo "用法: $0 <action> [options]"
  echo ""
  echo "Actions:"
  echo "  delete <file_path_in_repo> <commit_message>"
  echo "    删除仓库中的指定文件。"
  echo "    Example: $0 delete 'path/to/remote/file.txt' 'Delete old file'"
  echo ""
  echo "  upload <local_file_path> <file_path_in_repo> <commit_message>"
  echo "    上传/更新本地文件到仓库中的指定路径。"
  echo "    Example: $0 upload './local/new_file.txt' 'path/to/remote/new_file.txt' 'Add new feature file'"
  echo ""
  echo "请确保 GITHUB_TOKEN 环境变量已设置。"
  exit 1
}

# --- 必要检查 ---
if [ -z "$GITHUB_TOKEN" ]; then
  echo "错误: GITHUB_TOKEN 环境变量未设置。"
  usage
fi

if ! command -v curl &> /dev/null; then
    echo "错误: curl 未安装。"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "错误: jq 未安装。"
    exit 1
fi

if ! command -v mktemp &> /dev/null; then
    echo "错误: mktemp 未安装。"
    exit 1
fi


# --- 辅助函数：获取文件SHA (如果文件存在) ---
get_file_sha() {
  local file_path_in_repo="$1"
  local response
  response=$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
                  -H "Accept: application/vnd.github.v3+json" \
                  "${API_URL}/${file_path_in_repo}?ref=${BRANCH}")

  if echo "$response" | jq -e '.sha' > /dev/null; then
    echo "$response" | jq -r '.sha'
  else
    # 文件不存在或获取SHA失败
    echo ""
  fi
}

# --- 功能函数：删除文件 ---
delete_github_file() {
  local file_path_in_repo="$1"
  local commit_message="$2"
  local tmp_payload_file # 声明临时文件变量

  echo "正在尝试删除仓库中的文件: ${file_path_in_repo} ..."

  local file_sha
  file_sha=$(get_file_sha "${file_path_in_repo}")

  if [ -z "$file_sha" ]; then
    echo "错误: 文件 '${file_path_in_repo}' 在分支 '${BRANCH}' 上未找到，或无法获取其SHA。"
    return 1
  fi

  echo "获取到文件SHA: ${file_sha}"

  # 创建临时文件来存储JSON payload
  tmp_payload_file=$(mktemp)
  # 确保脚本退出时删除临时文件
  trap 'rm -f "$tmp_payload_file"' EXIT HUP INT QUIT TERM

  printf '{"message": "%s", "sha": "%s", "branch": "%s"}' \
    "$commit_message" \
    "$file_sha" \
    "$BRANCH" > "$tmp_payload_file"

  echo "发送删除请求 (payload from: $tmp_payload_file)..."
  response_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Content-Type: application/json" \
    --data-binary @"$tmp_payload_file" \
    "${API_URL}/${file_path_in_repo}")

  # 清理临时文件和trap
  rm -f "$tmp_payload_file"
  trap - EXIT HUP INT QUIT TERM # 清除trap

  if [ "$response_code" -eq 200 ] || [ "$response_code" -eq 204 ]; then
    echo "文件 '${file_path_in_repo}' 删除成功。HTTP状态: ${response_code}"
  else
    echo "错误: 删除文件 '${file_path_in_repo}' 失败。HTTP状态: ${response_code}"
    # printf '{"message": "%s", "sha": "%s", "branch": "%s"}' "$commit_message" "$file_sha" "$BRANCH" > payload.json
    # curl -i -X DELETE \
    #   -H "Authorization: token ${GITHUB_TOKEN}" \
    #   -H "Accept: application/vnd.github.v3+json" \
    #   -H "Content-Type: application/json" \
    #   --data-binary @payload.json \
    #   "${API_URL}/${file_path_in_repo}"
    # rm payload.json
    return 1
  fi
}

# --- 功能函数：上传/更新文件 ---
upload_github_file() {
  local local_file_path="$1"
  local file_path_in_repo="$2"
  local commit_message="$3"
  local tmp_payload_file # 声明临时文件变量

  if [ ! -f "$local_file_path" ]; then
    echo "错误: 本地文件 '${local_file_path}' 未找到。"
    return 1
  fi

  echo "正在准备上传/更新文件: ${local_file_path} 到仓库路径: ${file_path_in_repo} ..."

  local content_base64
  if [[ "$(uname)" == "Darwin" ]]; then # macOS
    content_base64=$(base64 < "$local_file_path")
  else # Assume GNU/Linux
    content_base64=$(base64 -w 0 < "$local_file_path")
  fi

  local current_sha
  current_sha=$(get_file_sha "${file_path_in_repo}")

  local json_payload_template='{"message": "%s", "content": "%s", "branch": "%s"%s}'
  local sha_part=""

  if [ -n "$current_sha" ]; then
    echo "文件 '${file_path_in_repo}' 已存在，SHA: ${current_sha}。将进行更新。"
    sha_part=$(printf ', "sha": "%s"' "$current_sha")
  else
    echo "文件 '${file_path_in_repo}' 不存在。将创建新文件。"
  fi

  # 创建临时文件来存储JSON payload
  tmp_payload_file=$(mktemp)
  # 确保脚本退出时删除临时文件
  trap 'rm -f "$tmp_payload_file"' EXIT HUP INT QUIT TERM

  printf "$json_payload_template" \
    "$commit_message" \
    "$content_base64" \
    "$BRANCH" \
    "$sha_part" > "$tmp_payload_file"

  echo "发送上传/更新请求 (payload from: $tmp_payload_file)..."
  response_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Content-Type: application/json" \
    --data-binary @"$tmp_payload_file" \
    "${API_URL}/${file_path_in_repo}")

  # 清理临时文件和trap
  rm -f "$tmp_payload_file"
  trap - EXIT HUP INT QUIT TERM # 清除trap

  if [ "$response_code" -eq 200 ] || [ "$response_code" -eq 201 ]; then # 200 for update, 201 for create
    echo "文件 '${file_path_in_repo}' 上传/更新成功。HTTP状态: ${response_code}"
  else
    echo "错误: 上传/更新文件 '${file_path_in_repo}' 失败。HTTP状态: ${response_code}"
    # printf "$json_payload_template" "$commit_message" "$content_base64" "$BRANCH" "$sha_part" > payload.json
    # curl -i -X PUT \
    #   -H "Authorization: token ${GITHUB_TOKEN}" \
    #   -H "Accept: application/vnd.github.v3+json" \
    #   -H "Content-Type: application/json" \
    #   --data-binary @payload.json \
    #   "${API_URL}/${file_path_in_repo}"
    # rm payload.json
    return 1
  fi
}

# --- 主逻辑 ---
ACTION="${1:-}"

case "$ACTION" in
  delete)
    if [ "$#" -ne 3 ]; then
      echo "错误: delete 操作需要 <file_path_in_repo> 和 <commit_message> 参数。"
      usage
    fi
    delete_github_file "$2" "$3"
    ;;
  upload)
    if [ "$#" -ne 4 ]; then
      echo "错误: upload 操作需要 <local_file_path>, <file_path_in_repo> 和 <commit_message> 参数。"
      usage
    fi
    upload_github_file "$2" "$3" "$4"
    ;;
  *)
    echo "错误: 未知操作或缺少操作参数。"
    usage
    ;;
esac

exit 0