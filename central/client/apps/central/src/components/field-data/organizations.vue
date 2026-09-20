<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Organizations: the tenants that own this deployment's Projects.

A role granted here reaches every Project the organization owns, so the page
says that plainly beside each role rather than leaving somebody to infer the
blast radius of a dropdown. Granting access is the one thing on this page that
is hard to see the consequences of and easy to get wrong.
-->
<template>
  <div id="field-data-organizations">
    <loading :state="loading"/>

    <template v-if="!loading">
      <p class="section-lead">{{ $t('lead') }}</p>

      <form v-if="canCreate" class="org-form" @submit.prevent="create">
        <input v-model.trim="draft.name" class="form-control" type="text"
          :placeholder="$t('field.name')" :aria-label="$t('field.name')" required>
        <input v-model.trim="draft.slug" class="form-control" type="text"
          :placeholder="$t('field.slug')" :aria-label="$t('field.slug')">
        <button type="submit" class="btn btn-primary"
          :aria-disabled="draft.name === '' || awaitingResponse">
          {{ $t('action.create') }} <spinner :state="awaitingResponse"/>
        </button>
      </form>

      <p v-if="organizations.length === 0" class="empty-table-message">
        {{ $t('none') }}
      </p>

      <article v-for="org of organizations" :key="org.id" class="org-card"
        :class="{ archived: org.archivedAt != null }">
        <header class="org-head">
          <div>
            <h3>
              {{ org.name }}
              <span v-if="org.archivedAt != null" class="org-archived">
                {{ $t('archived') }}
              </span>
            </h3>
            <p class="org-sub">
              <code>{{ org.slug }}</code> ·
              {{ $tc('projectCount', org.projectCount, { count: org.projectCount }) }}
            </p>
          </div>
          <div class="org-actions">
            <button type="button" class="btn btn-link btn-sm" @click="open(org)">
              {{ openSlug === org.slug ? $t('action.close') : $t('action.members') }}
            </button>
            <button v-if="org.canUpdate" type="button" class="btn btn-default btn-sm"
              @click="setArchived(org, org.archivedAt == null)">
              {{ org.archivedAt == null ? $t('action.archive') : $t('action.restore') }}
            </button>
          </div>
        </header>

        <div v-if="openSlug === org.slug" class="org-members">
          <loading :state="membersLoading"/>

          <template v-if="!membersLoading">
            <div v-if="members.length > 0" class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ $t('header.person') }}</th>
                  <th>{{ $t('header.role') }}</th>
                  <th v-if="openOrg?.canManageMembers"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="member of members" :key="member.actorId">
                  <td>
                    {{ member.displayName }}
                    <span v-if="member.email" class="member-email">{{ member.email }}</span>
                  </td>
                  <td>{{ member.roleName }}</td>
                  <td v-if="openOrg?.canManageMembers">
                    <button type="button" class="btn btn-danger btn-sm"
                      @click="removeMember(org, member)">{{ $t('action.remove') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
            <p v-else class="empty-table-message">{{ $t('noMembers') }}</p>

            <!-- The consequence of the choice, next to the choice. A role here
            reaches every Project the organization owns, which is not something
            a dropdown communicates on its own. -->
            <!-- Search rather than a dropdown of everybody. Listing all
            accounts takes user.list, which an organization owner does not
            have, so a dropdown would be empty for exactly the people this
            form is for. Searching by email is how Central adds somebody to a
            Project, and it answers for both. -->
            <form v-if="org.canManageMembers" class="member-form"
              @submit.prevent="addMember(org)">
              <div class="person-field">
                <input v-model.trim="personSearch" class="form-control" type="search"
                  :placeholder="$t('field.findPerson')" :aria-label="$t('field.findPerson')"
                  @input="findPeople">
                <p v-if="personSearch !== '' && !searching && candidates.length === 0"
                  class="person-none">
                  {{ $t('field.noPerson') }}
                </p>
                <ul v-else-if="candidates.length > 0" class="person-results">
                  <li v-for="person of candidates" :key="person.id">
                    <button type="button"
                      :class="['btn', 'btn-link', { chosen: newMember.actorId === person.id }]"
                      @click="choose(person)">
                      {{ person.displayName }}
                      <span v-if="person.email" class="member-email">{{ person.email }}</span>
                    </button>
                  </li>
                </ul>
              </div>
              <select v-model="newMember.role" class="form-control"
                :aria-label="$t('field.role')">
                <option value="">{{ $t('field.role') }}</option>
                <option v-for="role of roles" :key="role.name" :value="role.name">
                  {{ role.name }}
                </option>
              </select>
              <button type="submit" class="btn btn-primary"
                :aria-disabled="newMember.actorId === '' || newMember.role === '' || awaitingResponse">
                {{ $t('action.add') }}
              </button>
              <p v-if="roleDescription" class="role-note">
                <span class="icon-info-circle" aria-hidden="true"></span>
                {{ roleDescription }}
                {{ $tc('reaches', org.projectCount, { count: org.projectCount }) }}
              </p>
            </form>
          </template>
        </div>
      </article>
    </template>
  </div>
</template>

<script setup>
import { computed, inject, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataOrganizations' });

const { t } = useI18n();
const { request, awaitingResponse } = useRequest();
const { currentUser } = useRequestData();
const alert = inject('alert');

const loading = ref(true);
const membersLoading = ref(false);
const organizations = ref([]);
const roles = ref([]);
const members = ref([]);
const openSlug = ref(null);
const draft = reactive({ name: '', slug: '' });
const newMember = reactive({ actorId: '', role: '' });
const personSearch = ref('');
const candidates = ref([]);
const searching = ref(false);
let searchTimer;

// Creating a tenant is still site-wide: there is no organization yet to be
// the owner of. Everything after that is decided per organization by the
// server, which sends the answer with each row rather than leaving the
// interface to infer it from a permission that no longer governs.
const canCreate = computed(() => currentUser.dataExists && currentUser.can('config.set'));
const openOrg = computed(() => organizations.value.find(org => org.slug === openSlug.value));
const roleDescription = computed(() => roles.value
  .find(role => role.name === newMember.role)?.describe ?? '');

const loadOrganizations = () => request({
  method: 'GET', url: apiPaths.fieldDataOrganizations()
}).then(({ data }) => { organizations.value = data; });

Promise.all([
  loadOrganizations(),
  request({ method: 'GET', url: apiPaths.fieldDataOrganizationRoles() })
    .then(({ data }) => { roles.value = data; })
]).catch(noop).finally(() => { loading.value = false; });

// An exact email match comes back to anybody; a name match needs user.list.
// Either way the server decides what this caller may see, so the same request
// serves an administrator and an organization owner.
const findPeople = () => {
  clearTimeout(searchTimer);
  newMember.actorId = '';
  const term = personSearch.value;
  if (term === '') { candidates.value = []; return; }
  searchTimer = setTimeout(() => {
    searching.value = true;
    request({ method: 'GET', url: apiPaths.users({ q: term }) })
      .then(({ data }) => { candidates.value = data.slice(0, 10); })
      .catch(() => { candidates.value = []; })
      .finally(() => { searching.value = false; });
  }, 350);
};

const choose = (person) => { newMember.actorId = person.id; };

const create = () => request({
  method: 'POST',
  url: apiPaths.fieldDataOrganizations(),
  data: { name: draft.name, slug: draft.slug || undefined }
})
  .then(() => {
    alert.success(t('alert.created', { name: draft.name }));
    draft.name = '';
    draft.slug = '';
    return loadOrganizations();
  })
  .catch(noop);

const setArchived = (org, archived) => request({
  method: 'PATCH',
  url: apiPaths.fieldDataOrganization(org.slug),
  data: { archived }
}).then(loadOrganizations).catch(noop);

const open = (org) => {
  if (openSlug.value === org.slug) { openSlug.value = null; return; }
  openSlug.value = org.slug;
  members.value = [];
  newMember.actorId = '';
  newMember.role = '';
  personSearch.value = '';
  candidates.value = [];
  membersLoading.value = true;
  request({ method: 'GET', url: apiPaths.fieldDataOrganizationMembers(org.slug) })
    .then(({ data }) => { members.value = data; })
    .catch(noop)
    .finally(() => { membersLoading.value = false; });
};

const addMember = (org) => request({
  method: 'POST',
  url: apiPaths.fieldDataOrganizationMembers(org.slug),
  data: { actorId: Number(newMember.actorId), role: newMember.role }
})
  .then(() => {
    newMember.actorId = '';
    newMember.role = '';
    personSearch.value = '';
    candidates.value = [];
    return request({ method: 'GET', url: apiPaths.fieldDataOrganizationMembers(org.slug) })
      .then(({ data }) => { members.value = data; });
  })
  .catch(noop);

const removeMember = (org, member) => {
  if (!window.confirm(t('confirmRemove', { name: member.displayName, org: org.name }))) return;
  request({
    method: 'DELETE',
    url: apiPaths.fieldDataOrganizationMember(org.slug, member.actorId)
  })
    .then(() => request({ method: 'GET', url: apiPaths.fieldDataOrganizationMembers(org.slug) }))
    .then(({ data }) => { members.value = data; })
    .catch(noop);
};
</script>

<i18n lang="json5">
{
  "en": {
    "lead": "An organization owns Projects. A role granted here applies to every Project the organization owns, which is what makes it different from granting somebody access to one Project at a time.",
    "none": "No organizations yet.",
    "archived": "Archived",
    "noMembers": "Nobody has been given a role in this organization yet.",
    "projectCount": "{count} Project | {count} Projects",
    // Shown beside the role description, so the reach of the grant is visible
    // at the moment somebody chooses it.
    "reaches": "This applies to the organization's {count} Project. | This applies to all {count} of the organization's Projects.",
    "field": {
      "name": "Organization name",
      "slug": "Short name for links (optional)",
      "person": "Person",
      "findPerson": "Find somebody by email",
      "noPerson": "No account matches that. An exact email address always works; searching by name needs permission to list users.",
      "role": "Role"
    },
    "header": { "person": "Person", "role": "Role" },
    "action": {
      "create": "Add organization",
      "members": "Members",
      "close": "Close",
      "archive": "Archive",
      "restore": "Restore",
      "add": "Give role",
      "remove": "Remove"
    },
    "confirmRemove": "Remove {name} from {org}? Any access they were given directly on a Project stays as it is.",
    "alert": { "created": "Organization “{name}” has been created." }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#field-data-organizations {
  padding-top: 20px;

  .section-lead {
    color: $color-text-muted;
    font-size: 13px;
    margin: 0 0 14px;
    max-width: 82ch;
  }

  .org-form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 24px;

    .form-control { flex: 1 1 220px; width: auto; }
  }

  .org-card {
    border: 1px solid #e9e9f1;             // gradient --gray-150
    border-radius: 6px;
    margin-bottom: 12px;
    padding: 14px 16px;

    &.archived { background-color: #f8f8fb; }  // gradient --gray-50
  }

  .org-head {
    display: flex;
    gap: 16px;
    justify-content: space-between;

    h3 { color: $color-text; font-size: 14px; font-weight: 600; margin: 0; }
  }

  .org-archived {
    color: $color-text-muted;
    font-size: 11px;
    font-weight: normal;
    letter-spacing: 0.05em;
    margin-left: 6px;
    text-transform: uppercase;
  }

  .org-sub {
    color: $color-text-muted;
    font-size: 12px;
    margin: 2px 0 0;

    code { background: none; font-size: 12px; padding: 0; }
  }

  .org-actions { display: flex; flex-shrink: 0; gap: 4px; }

  .org-members { margin-top: 14px; }

  .member-email {
    color: $color-text-muted;
    font-size: 12px;
    margin-left: 6px;
  }

  .member-form {
    align-items: flex-start;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    .form-control { flex: 0 1 220px; width: auto; }
  }

  .person-field { flex: 0 1 260px; }

  .person-none {
    color: $color-text-muted;
    font-size: 12px;
    margin: 4px 0 0;
  }

  .person-results {
    border: 1px solid #e9e9f1;           // gradient --gray-150
    border-radius: 4px;
    list-style: none;
    margin: 4px 0 0;
    max-height: 180px;
    overflow-y: auto;
    padding: 2px;

    .btn-link {
      display: block;
      padding: 4px 8px;
      text-align: left;
      width: 100%;

      &.chosen {
        background-color: #f1f1f6;       // gradient --gray-100
        font-weight: 600;
      }
    }
  }

  .role-note {
    background-color: #f1f1f6;             // gradient --gray-100
    border-radius: 4px;
    color: $color-text-secondary;
    flex: 1 1 100%;
    font-size: 12px;
    margin: 4px 0 0;
    max-width: 82ch;
    padding: 8px 10px;

    // Icon first so [class^="icon-"] matches and the glyph resolves.
    [class^="icon-"] { margin-right: 6px; }
  }
}
</style>
