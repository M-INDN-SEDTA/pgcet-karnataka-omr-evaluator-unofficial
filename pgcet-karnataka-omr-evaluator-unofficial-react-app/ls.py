import os
import argparse
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

# Define emojis for different file types
EMOJIS = {
    "folder": "📁",
    "py": "🐍",
    "txt": "📄",
    "jpg": "🖼️",
    "png": "🖼️",
    "mp3": "🎵",
    "csv": "🗃️",
    "log": "📜",
    "default": "📄"
}

# Get emoji for a file type
def get_emoji(filename, is_folder, use_emoji):
    """Returns the corresponding emoji for a file or folder."""
    if not use_emoji:
        return ""
    return EMOJIS["folder"] if is_folder else EMOJIS.get(filename.split(".")[-1].lower(), EMOJIS["default"])

# Format timestamps
def format_time(timestamp):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp))

# Get file permissions in ugo format
def get_permissions(path):
    mode = os.stat(path).st_mode
    permissions = []
    for who in [0o400, 0o040, 0o004]:  # Read (ugo)
        permissions.append("r" if mode & who else "-")
    for who in [0o200, 0o020, 0o002]:  # Write (ugo)
        permissions.append("w" if mode & who else "-")
    for who in [0o100, 0o010, 0o001]:  # Execute (ugo)
        permissions.append("x" if mode & who else "-")
    return "".join(permissions[:3]) + "".join(permissions[3:6]) + "".join(permissions[6:])  # ugo format

# Generate the file structure
def generate_structure(path, args, depth=0, prefix=""):
    if args.depth and depth > args.depth:
        return []

    result = []
    path = Path(path).resolve()

    try:
        entries = sorted(os.scandir(path), key=lambda e: (e.is_file(), e.name.lower()))  # Sort folders first
        last_index = len(entries) - 1

        for i, entry in enumerate(entries):
            entry_path = Path(entry.path).resolve()

            # Skip hidden files unless explicitly allowed
            if not args.hidden and entry.name.startswith("."):
                continue

            # Skip excluded folders
            if entry.is_dir() and entry.name in args.exclude:
                continue

            # Ensure subfolders of included directories are scanned
            if args.include:
                is_inside_included = any(inc in str(entry_path) for inc in args.include)
                if not is_inside_included and entry.name not in args.include:
                    continue  # Skip if not explicitly included or inside an included folder

            # Filter by file type
            if args.types and not entry.name.endswith(tuple(args.types)):
                continue

            # Check flags
            show_cr = args.creation_date or args.all_details
            show_ud = args.updated_date or args.all_details
            show_ac = args.accessed_time or args.all_details  # ✅ FIXED: Using correct flag name
            show_pr = args.permissions or args.all_details

            # Get metadata
            emoji = get_emoji(entry.name, entry.is_dir(), args.emoji)
            creation_date = format_time(entry.stat().st_ctime) if show_cr else None
            modified_date = format_time(entry.stat().st_mtime) if show_ud else None
            accessed_date = format_time(entry.stat().st_atime) if show_ac else None
            permissions = get_permissions(entry.path) if show_pr else None

            # Format name
            formatted_name = f"{emoji} {entry.name}".strip()  # Strip removes extra spaces if no emoji
            metadata = []

            if show_cr:
                metadata.append(f"📅 Created: {creation_date}")
            if show_ud:
                metadata.append(f"📝 Modified: {modified_date}")
            if show_ac:
                metadata.append(f"👀 Accessed: {accessed_date}")
            if show_pr:
                metadata.append(f"🔑 Perms: {permissions}")

            if metadata:
                formatted_name += f" ({' | '.join(metadata)})"

            # Indentation
            if args.clean:
                indent = "    " * depth  # Clean format uses spaces
                new_prefix = "    " * (depth + 1)
            else:
                indent = f"{prefix}├── " if i < last_index else f"{prefix}└── "
                new_prefix = f"{prefix}│   " if i < last_index else f"{prefix}    "

            result.append(f"{indent}{formatted_name}")

            # Recursively process subdirectories
            if entry.is_dir():
                result.extend(generate_structure(entry.path, args, depth + 1, new_prefix))

    except PermissionError:
        result.append(f"{prefix}🚫 Access Denied: {path}")

    return result

# Save output
def save_output(output, output_file, root_name, clean_format):
    try:
        if clean_format:
            header = f"📂 {root_name} (File Structure)\n{'=' * (len(root_name) + 18)}\n"
        else:
            header = f"📂 {root_name}\n"

        with open(output_file, "w", encoding="utf-8") as f:
            f.write(header + "\n".join(output))
    except Exception as e:
        print(f"❌ Error saving file: {e}")

# Parse command-line arguments
def parse_arguments():
    parser = argparse.ArgumentParser(description="List files & folders in a structured format.")
    parser.add_argument("-e", "--exclude", nargs="*", default=[], help="Exclude specific folders")
    parser.add_argument("-i", "--include", nargs="*", default=[], help="Include only specific folders (with subfolders)")
    parser.add_argument("-d", "--depth", type=int, help="Limit depth level")
    parser.add_argument("-t", "--types", nargs="*", help="Filter by file type (.py .md)")
    parser.add_argument("-hidden", "--hidden", action="store_true", help="Include hidden files")
    parser.add_argument("-c", "--clean", action="store_true", help="Use clean formatting")
    parser.add_argument("-em", "--emoji", action="store_true", help="Add emojis before files and folders")

    # New flags for metadata
    parser.add_argument("-cr", "--creation-date", action="store_true", help="Show file creation date")
    parser.add_argument("-ud", "--updated-date", action="store_true", help="Show last modified date")
    parser.add_argument("-ac", "--accessed-time", action="store_true", help="Show last accessed time")  # ✅ FIXED
    parser.add_argument("-pr", "--permissions", action="store_true", help="Show file permissions")
    parser.add_argument("-ad", "--all-details", action="store_true", help="Show ALL details (-cr, -ud, -ac, -pr)")

    return parser.parse_args()

# Main execution
def main():
    args = parse_arguments()

    current_folder = Path.cwd()
    root_name = current_folder.name
    output_file = current_folder / f"{root_name}_FileStructure.txt"

    with ThreadPoolExecutor() as executor:
        structure = list(executor.submit(generate_structure, str(current_folder), args).result())

    save_output(structure, output_file, root_name, args.clean)

    print(f"📄 File structure saved to: {output_file}")

if __name__ == "__main__":
    main()
