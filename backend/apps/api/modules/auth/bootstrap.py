"""Run with python -m apps.api.modules.auth.bootstrap; never put passwords in argv."""
import argparse
import getpass

from apps.api.core.config import get_settings
from apps.api.modules.auth.store import AuthStore


def main() -> None:
    parser = argparse.ArgumentParser(description="预设或重置管理员账号（普通用户通过手机号注册）")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--reset-password", action="store_true")
    args = parser.parse_args()
    password = getpass.getpass("登录密码（6～128 位）: ")
    if password != getpass.getpass("再次输入密码: "):
        raise SystemExit("两次密码不一致，未修改账号。")
    settings = get_settings()
    store = AuthStore(settings)
    store.provision_admin(args.username, password, replace=args.reset_password)
    print("管理员账号已配置；已有账号需加 --reset-password 才会重置密码。")


if __name__ == "__main__":
    main()
