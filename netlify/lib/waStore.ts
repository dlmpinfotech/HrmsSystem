import type { SupabaseClient } from '@supabase/supabase-js';
import { shouldAdvanceStatus, type WaStore } from './whatsapp';

/** Supabase-backed persistence for WhatsApp webhook events. */
export function createWaStore(db: SupabaseClient): WaStore {
  return {
    async saveInbound(message) {
      let { data: conv } = await db.from('whatsapp_conversations').select('id, lead_id, unread_count').eq('wa_phone', message.from).maybeSingle();
      if (!conv) {
        const { data: lead } = await db
          .from('leads')
          .select('id')
          .eq('phone_normalized', message.from.slice(-10))
          .order('created_at', { ascending: false })
          .limit(1);
        const created = await db
          .from('whatsapp_conversations')
          .upsert({ wa_phone: message.from, contact_name: message.contactName, lead_id: lead?.[0]?.id ?? null }, { onConflict: 'wa_phone' })
          .select('id, lead_id, unread_count')
          .single();
        conv = created.data;
      }
      if (!conv) throw new Error('could not open conversation');

      // wa_message_id is UNIQUE — a redelivered webhook hits 23505 and is ignored.
      const { error } = await db.from('whatsapp_messages').insert({
        conversation_id: conv.id,
        direction: 'inbound',
        wa_message_id: message.waMessageId,
        type: message.type,
        body: message.body,
        status: 'received',
        payload: message.raw as object,
        created_at: message.timestamp,
      });
      if (error) {
        if (error.code === '23505') return false;
        throw new Error(error.message);
      }

      await db
        .from('whatsapp_conversations')
        .update({
          contact_name: message.contactName ?? undefined,
          last_message_at: message.timestamp,
          last_inbound_at: message.timestamp,
          unread_count: (conv.unread_count ?? 0) + 1,
        })
        .eq('id', conv.id);

      if (conv.lead_id) {
        await db.from('lead_activities').insert({
          lead_id: conv.lead_id,
          type: 'whatsapp',
          body: message.body ? `Incoming WhatsApp: ${message.body.slice(0, 500)}` : `Incoming WhatsApp (${message.type})`,
        });
      }
      return true;
    },

    async applyStatus(update) {
      const { data: msg } = await db.from('whatsapp_messages').select('id, status').eq('wa_message_id', update.waMessageId).maybeSingle();
      if (msg && shouldAdvanceStatus(msg.status, update.status)) {
        await db.from('whatsapp_messages').update({ status: update.status, error: update.error }).eq('id', msg.id);
      }
      const { data: log } = await db.from('notification_logs').select('id, status').eq('provider_message_id', update.waMessageId).maybeSingle();
      if (log && shouldAdvanceStatus(log.status, update.status)) {
        await db.from('notification_logs').update({ status: update.status, error: update.error }).eq('id', log.id);
      }
    },

    async recordOptOut(phone) {
      await db.from('communication_consents').insert({ phone, channel: 'whatsapp', granted: false, source: 'whatsapp_stop', revoked_at: new Date().toISOString(), wording: 'User replied STOP' });
    },
  };
}
