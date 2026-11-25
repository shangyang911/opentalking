"""Isolate integration tables when the test account has database-local privileges."""
import re


class PrefixedCursor:
    def __init__(self, cursor, prefix):
        self.cursor, self.prefix = cursor, prefix

    def execute(self, sql, args=None):
        # Only rewrite our fixed authentication identifiers, never data values.
        sql = re.sub(r"\bauth_(users|sessions|codes|limits|meta|mutex|profiles|users_role)\b",
                     lambda match: self.prefix + match.group(1), sql)
        sql = re.sub(r"\bbilling_(accounts|plans|orders|grants|reservations|usage)\b",
                     lambda match: self.prefix + 'b_' + match.group(1), sql)
        return self.cursor.execute(sql, args)

    def __getattr__(self, name):
        return getattr(self.cursor, name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.cursor.close()


class PrefixedConnection:
    def __init__(self, connection, prefix):
        self.connection, self.prefix = connection, prefix

    def cursor(self):
        return PrefixedCursor(self.connection.cursor(), self.prefix)

    def __getattr__(self, name):
        return getattr(self.connection, name)
