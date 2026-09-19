-- Create the first administrator by hand.
--
-- The container normally does this on boot (see `bootstrap_admin` in
-- entrypoint.sh). Run this only when that has not happened and you want an
-- account now: paste it into the Supabase SQL editor, having replaced the two
-- values at the top.
--
-- The password must be at least 10 characters and at most 72 bytes, which is
-- what the server itself enforces. bcrypt is bcrypt, so a hash made here by
-- pgcrypto is one the server will verify; the cost factor matches the server's.
--
-- Running it twice is safe: the second run finds the account and changes
-- nothing.

do $$
declare
  admin_email    text := 'admin@fielddata.quantixsl.com';
  admin_password text := 'replace-with-the-real-password';

  new_actee uuid := gen_random_uuid();
  new_actor int;
  admin_role int;
begin
  if admin_password = 'replace-with-the-real-password' then
    raise exception 'Set admin_password before running this.';
  end if;
  if length(admin_password) < 10 then
    raise exception 'The password must be at least 10 characters; this one is %.',
      length(admin_password);
  end if;
  if octet_length(admin_password) > 72 then
    raise exception 'The password must be at most 72 bytes; this one is %.',
      octet_length(admin_password);
  end if;

  if exists (select 1 from field_data.users where email = admin_email) then
    raise notice '% already exists; nothing was changed.', admin_email;
    return;
  end if;

  select id into admin_role from field_data.roles where system = 'admin';
  if admin_role is null then
    raise exception 'No administrator role exists. Have the migrations run?';
  end if;

  -- An actor is what the permission system grants to; the actee is what it can
  -- be named as a target of. Every actor has one, so the user gets one here.
  insert into field_data.actees (id, species) values (new_actee, 'user');
  insert into field_data.actors (type, "acteeId", "displayName", "createdAt")
    values ('user', new_actee, admin_email, clock_timestamp())
    returning id into new_actor;

  -- The display name is the email address. That is what the server does when
  -- it creates a user without one, and the person can change it once in.
  insert into field_data.users ("actorId", password, email)
    values (new_actor,
            extensions.crypt(admin_password, extensions.gen_salt('bf', 12)),
            admin_email);

  -- '*' is the actee that means "everything", so this is administrator over
  -- the whole installation rather than over one project.
  insert into field_data.assignments ("actorId", "roleId", "acteeId")
    values (new_actor, admin_role, '*');

  raise notice 'Created % as an administrator.', admin_email;
end $$;

-- Confirm it. One row, with 'Administrator' in the last column.
select u.email, a."displayName", r.name
from field_data.users u
  join field_data.actors a on a.id = u."actorId"
  left join field_data.assignments s on s."actorId" = u."actorId"
  left join field_data.roles r on r.id = s."roleId";
